"""
Semantic SQL Analyzer for Table Variables, Temporary Tables, CTEs, and Physical Tables.
Validates column references without side-effects for SQL Server (T-SQL) and PostgreSQL.

Detects invalid columns in:
- Physical tables (resolved via active database connection/metadata or client cache)
- Temporary tables (#temp, ##temp, CREATE TEMP TABLE, SELECT ... INTO #temp)
- Table variables (DECLARE @tbl TABLE (...))
- CTEs (WITH cte AS (...))

Reference: .SKILL/sytax_check.md
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# Global in-memory cache for physical table columns
# Key: (connection_id, dialect, server_lower, database_lower, schema_lower, table_lower) -> (timestamp, set of lowercase column names)
_PHYSICAL_TABLE_COLUMNS_CACHE: dict[tuple[str, str, str, str, str, str], tuple[float, set[str]]] = {}
DEFAULT_COLUMN_CACHE_TTL = 60.0  # seconds


def _get_cached_columns(cache_key: tuple) -> set[str] | None:
    entry = _PHYSICAL_TABLE_COLUMNS_CACHE.get(cache_key)
    if entry is None:
        return None
    if isinstance(entry, tuple) and len(entry) == 2 and isinstance(entry[0], (int, float)):
        ts, cols = entry
        if time.time() - ts < DEFAULT_COLUMN_CACHE_TTL:
            return cols
        _PHYSICAL_TABLE_COLUMNS_CACHE.pop(cache_key, None)
        return None
    elif isinstance(entry, set):
        return entry
    return None


def _set_cached_columns(cache_key: tuple, cols: set[str]) -> None:
    _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = (time.time(), cols)


def invalidate_physical_table_columns_cache(
    connection_id: str | None = None,
    database: str | None = None,
    schema: str | None = None,
    table_name: str | None = None,
) -> int:
    """
    Invalidate entries in _PHYSICAL_TABLE_COLUMNS_CACHE matching criteria.
    If no arguments provided, clears all entries.
    """
    if connection_id is None and database is None and schema is None and table_name is None:
        count = len(_PHYSICAL_TABLE_COLUMNS_CACHE)
        _PHYSICAL_TABLE_COLUMNS_CACHE.clear()
        return count

    clean_conn = str(connection_id).strip().lower() if connection_id else None
    clean_db = str(database).strip().lower() if database else None
    clean_schema = str(schema).strip().lower() if schema else None
    clean_tbl = clean_identifier(table_name).lower() if table_name else None

    keys_to_remove = []
    for key in list(_PHYSICAL_TABLE_COLUMNS_CACHE.keys()):
        if len(key) == 6:
            k_conn, _k_dia, _k_srv, k_db, k_sch, k_tbl = key
        elif len(key) == 5:
            _k_dia, _k_srv, k_db, k_sch, k_tbl = key
            k_conn = ""
        else:
            continue

        if clean_conn is not None and k_conn and k_conn != clean_conn:
            continue
        if clean_db is not None and k_db and k_db != clean_db:
            continue
        if clean_schema is not None and k_sch and k_sch != clean_schema:
            continue
        if clean_tbl is not None and k_tbl != clean_tbl:
            continue
        keys_to_remove.append(key)

    for k in keys_to_remove:
        _PHYSICAL_TABLE_COLUMNS_CACHE.pop(k, None)
    return len(keys_to_remove)


def clear_physical_table_columns_cache() -> None:
    """Clear all in-memory physical table column caches."""
    _PHYSICAL_TABLE_COLUMNS_CACHE.clear()


_DDL_TABLE_REGEX = re.compile(
    r"\b(CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER|DROP)\s+(TABLE|VIEW)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([^\s;(]+)",
    re.IGNORECASE,
)


def invalidate_on_ddl(sql: str, connection_id: str | None = None, database: str | None = None) -> int:
    """
    Detect DDL statements (CREATE/ALTER/DROP TABLE or VIEW) in SQL and invalidate matching cache entries.
    """
    if not sql or not isinstance(sql, str):
        return 0
    total = 0
    for match in _DDL_TABLE_REGEX.finditer(sql):
        raw_target = match.group(3).strip()
        parts = [clean_identifier(p) for p in raw_target.split(".") if p.strip()]
        tbl_name = None
        sch_name = None
        db_name = database
        if len(parts) >= 3:
            db_name, sch_name, tbl_name = parts[-3], parts[-2], parts[-1]
        elif len(parts) == 2:
            sch_name, tbl_name = parts[0], parts[1]
        elif len(parts) == 1:
            tbl_name = parts[0]
        if tbl_name:
            total += invalidate_physical_table_columns_cache(
                connection_id=connection_id,
                database=db_name,
                schema=sch_name,
                table_name=tbl_name,
            )
    return total

# SQL Keywords and Built-in Function names that should never be treated as column names
_SQL_RESERVED_IDENTIFIERS = {
    # Keywords
    "select", "from", "where", "and", "or", "not", "null", "true", "false",
    "as", "on", "in", "is", "like", "between", "case", "when", "then", "else", "end",
    "asc", "desc", "all", "distinct", "top", "limit", "offset", "union", "except", "intersect",
    "join", "inner", "left", "right", "full", "cross", "outer", "natural", "apply",
    "group", "by", "order", "having", "into", "values", "set", "update", "delete", "insert",
    "create", "alter", "drop", "table", "view", "procedure", "function", "trigger", "index",
    "declare", "begin", "commit", "rollback", "transaction", "tran", "exec", "execute",
    "with", "as", "over", "partition", "exists", "any", "some", "collate",
    "within", "filter", "respect", "ignore", "nulls", "preceding", "following", "unbounded",
    "current", "row", "rows", "range", "ties", "percent", "tablesample", "repeatable",
    "pivot", "unpivot", "lateral", "openjson", "openxml", "opendatasource", "openquery", "openrowset",
    "for", "xml", "path", "raw", "auto", "explicit", "elements", "browse",
    "readpast", "nolock", "updlock", "holdlock", "tablock", "tablockx", "paglock", "rowlock", "nowait",
    "try", "catch", "throw", "raiserror", "while", "break", "continue", "goto", "return", "waitfor", "delay",
    "truncate", "merge", "matched", "target", "source", "output", "inserted", "deleted",
    "fast_forward", "read_only", "scroll",
    # Common built-in functions
    "count", "sum", "avg", "min", "max", "getdate", "now", "coalesce", "isnull", "nullif",
    "upper", "lower", "trim", "ltrim", "rtrim", "len", "length", "substring", "substr",
    "replace", "charindex", "instr", "dateadd", "datediff", "datepart", "convert", "cast",
    "round", "floor", "ceiling", "ceil", "abs", "row_number", "rank", "dense_rank", "ntile",
    "lag", "lead", "first_value", "last_value", "stuff", "format", "string_agg", "string_split",
    "percentile_cont", "percentile_disc",
    "concat", "concat_ws", "iif", "choose", "newid", "gen_random_uuid", "current_timestamp",
    "current_date", "current_time", "current_user", "session_user", "system_user", "user",
    "identity", "scope_identity", "error_message", "error_number", "error_line",
    # Data type names
    "int", "bigint", "smallint", "tinyint", "bit", "decimal", "numeric", "money", "smallmoney",
    "float", "real", "datetime", "datetime2", "date", "time", "char", "varchar", "nchar", "nvarchar",
    "text", "ntext", "binary", "varbinary", "image", "uniqueidentifier", "xml", "boolean", "text",
    "integer", "serial", "bigserial", "timestamp", "timestamptz", "json", "jsonb", "uuid",
    "int2", "int4", "int8", "float4", "float8", "bytea", "citext", "interval", "smalldatetime",
    "datetimeoffset", "rowversion", "hierarchyid", "geometry", "geography", "sql_variant"
}


def clean_identifier(name: str) -> str:
    """Strip quotes, square brackets, and leading/trailing whitespace."""
    if not name:
        return ""
    s = name.strip()
    if (s.startswith("[") and s.endswith("]")) or (s.startswith('"') and s.endswith('"')) or (s.startswith("`") and s.endswith("`")):
        s = s[1:-1].strip()
    return s


def split_qualified_table_name(raw: str) -> tuple[str | None, str | None, str | None, str]:
    """
    Split a 1-part, 2-part, 3-part, or 4-part table identifier into:
    (server, database, schema, table).
    Handles bracketed [part] and quoted "part" correctly.
    Examples:
    - 'tbl' -> (None, None, None, 'tbl')
    - 'dbo.tbl' -> (None, None, 'dbo', 'tbl')
    - '[dbo].[tbl]' -> (None, None, 'dbo', 'tbl')
    - 'db.dbo.tbl' -> (None, 'db', 'dbo', 'tbl')
    - '[SRV].[db].[dbo].[tbl]' -> ('SRV', 'db', 'dbo', 'tbl')
    - 'SRV..dbo.tbl' -> ('SRV', None, 'dbo', 'tbl')
    """
    if not raw:
        return None, None, None, ""
    raw = raw.strip()
    parts: list[str] = []
    curr: list[str] = []
    in_bracket = False
    in_quote = False

    for ch in raw:
        if ch == "[" and not in_quote:
            in_bracket = True
            curr.append(ch)
        elif ch == "]" and in_bracket:
            in_bracket = False
            curr.append(ch)
        elif ch == '"' and not in_bracket:
            in_quote = not in_quote
            curr.append(ch)
        elif ch == "." and not in_bracket and not in_quote:
            parts.append("".join(curr).strip())
            curr = []
        else:
            curr.append(ch)
    if curr:
        parts.append("".join(curr).strip())

    cleaned = [clean_identifier(p) for p in parts]
    n = len(cleaned)
    if n == 1:
        return None, None, None, cleaned[0]
    elif n == 2:
        return None, None, cleaned[0] or None, cleaned[1]
    elif n == 3:
        return None, cleaned[0] or None, cleaned[1] or None, cleaned[2]
    elif n >= 4:
        return cleaned[0] or None, cleaned[1] or None, cleaned[2] or None, cleaned[3]
    return None, None, None, raw


def _extract_columns_from_parentheses_content(content: str) -> set[str]:
    """
    Extract column names from the content of a CREATE TABLE / DECLARE TABLE body.
    Handles nested parentheses (e.g. DECIMAL(18, 2), CHECK (...)) without breaking.
    """
    columns: set[str] = set()
    depth = 0
    current_token: list[str] = []

    items: list[str] = []
    for ch in content:
        if ch == "(":
            depth += 1
            current_token.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            current_token.append(ch)
        elif ch == "," and depth == 0:
            item = "".join(current_token).strip()
            if item:
                items.append(item)
            current_token = []
        else:
            current_token.append(ch)

    last_item = "".join(current_token).strip()
    if last_item:
        items.append(last_item)

    constraint_starters = {
        "constraint", "primary", "foreign", "check", "unique", "index", "key", "default"
    }

    for item in items:
        # Strip comments
        item = re.sub(r"--.*$", "", item)
        item = re.sub(r"/\*.*?\*/", "", item, flags=re.DOTALL).strip()
        if not item:
            continue

        first_word = re.split(r"[\s\(\]]+", item)[0]
        first_word_clean = clean_identifier(first_word).lower()
        if first_word_clean in constraint_starters:
            continue

        # Match first identifier
        m = re.match(r"^\s*(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))", item)
        if m:
            col_name = m.group(1) or m.group(2) or m.group(3)
            if col_name and col_name.lower() not in _SQL_RESERVED_IDENTIFIERS:
                columns.add(clean_identifier(col_name).lower())

    return columns


def extract_table_variables(sql: str) -> dict[str, set[str]]:
    """
    Extract T-SQL table variables:
    DECLARE @myTable TABLE ( id INT, code VARCHAR(50) )
    Returns mapping: '@mytable' -> {'id', 'code'}.
    """
    table_vars: dict[str, set[str]] = {}
    pattern = re.compile(r"DECLARE\s+(@\w+)\s+TABLE\s*\(", re.IGNORECASE)

    for match in pattern.finditer(sql):
        var_name = match.group(1).lower()
        start_idx = match.end() - 1  # points to '('
        
        # Balance parentheses
        depth = 0
        end_idx = -1
        for i in range(start_idx, len(sql)):
            if sql[i] == "(":
                depth += 1
            elif sql[i] == ")":
                depth -= 1
                if depth == 0:
                    end_idx = i
                    break
        
        if end_idx != -1:
            body = sql[start_idx + 1:end_idx]
            cols = _extract_columns_from_parentheses_content(body)
            if cols:
                table_vars[var_name] = cols

    return table_vars


def _extract_projection_column_name(expr: str) -> str:
    """Extract effective column name or alias from a single SELECT projection expression."""
    expr = re.sub(r"/\*.*?\*/", " ", expr, flags=re.DOTALL)
    expr = re.sub(r"--.*$", " ", expr, flags=re.MULTILINE).strip()
    if not expr:
        return ""
    # Strip leading DISTINCT, ALL, TOP
    expr = re.sub(r"^\s*DISTINCT\s+", "", expr, flags=re.IGNORECASE)
    expr = re.sub(r"^\s*ALL\s+", "", expr, flags=re.IGNORECASE)
    expr = re.sub(r"^\s*TOP\s+(?:\([^\)]+\)|\d+)(?:\s+PERCENT)?(?:\s+WITH\s+TIES)?\s+", "", expr, flags=re.IGNORECASE).strip()
    if not expr:
        return ""
    if expr == "*" or expr.endswith(".*"):
        return "*"

    # 1. Match: expr AS alias or expr AS [alias] or expr AS "alias"
    as_match = re.search(r"\bAS\s+(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*$", expr, re.IGNORECASE)
    if as_match:
        alias = as_match.group(1) or as_match.group(2) or as_match.group(3)
        return clean_identifier(alias).lower()

    # 2. Match: alias = expr (T-SQL alias assignment)
    t_sql_alias = re.match(r"^\s*(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*=\s*", expr)
    if t_sql_alias:
        alias = t_sql_alias.group(1) or t_sql_alias.group(2) or t_sql_alias.group(3)
        return clean_identifier(alias).lower()

    # 3. Match: expr alias (implicit alias without AS keyword, e.g. CAST(...) _Check or 1 flag)
    # The alias token must follow a closing paren, closing quote, bracket, or digit
    implicit_alias = re.search(r"(?:[\)'\"\]]|\d+)\s+(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*$", expr)
    if implicit_alias:
        alias = implicit_alias.group(1) or implicit_alias.group(2) or implicit_alias.group(3)
        return clean_identifier(alias).lower()

    # 4. Match simple column: tbl.col or col or [col]
    simple_col = re.match(r"^(?:(?:[#@\w\.\"\[\]]+)\.)?(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*$", expr)
    if simple_col:
        col = simple_col.group(1) or simple_col.group(2) or simple_col.group(3)
        return clean_identifier(col).lower()

    return ""


def _extract_columns_from_proj_str(proj_str: str) -> set[str]:
    """Parse projection string with balanced parentheses and return set of column names/aliases."""
    cols = set()
    depth = 0
    curr: list[str] = []
    has_wildcard = False
    for ch in proj_str:
        if ch == "(":
            depth += 1
            curr.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            curr.append(ch)
        elif ch == "," and depth == 0:
            item = "".join(curr).strip()
            if item:
                if "*" in item:
                    has_wildcard = True
                c = _extract_projection_column_name(item)
                if c:
                    cols.add(c)
            curr = []
        else:
            curr.append(ch)
    last = "".join(curr).strip()
    if last:
        if "*" in last:
            has_wildcard = True
        c = _extract_projection_column_name(last)
        if c:
            cols.add(c)
    if has_wildcard:
        cols.add("*")
    return {c for c in cols if c}


def _extract_col_name_from_add_clause(item: str) -> str:
    item = re.sub(r"/\*.*?\*/", " ", item, flags=re.DOTALL)
    item = re.sub(r"--.*$", " ", item, flags=re.MULTILINE).strip()
    if not item:
        return ""
    if re.match(r"^\s*(?:CONSTRAINT|PRIMARY|FOREIGN|CHECK|UNIQUE|INDEX)\b", item, re.IGNORECASE):
        return ""
    item = re.sub(r"^\s*COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?", "", item, flags=re.IGNORECASE).strip()
    m = re.match(r"^(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))", item)
    if m:
        raw = m.group(1) or m.group(2) or m.group(3)
        return clean_identifier(raw).lower()
    return ""


def _extract_columns_from_alter_add_body(body: str) -> set[str]:
    cols = set()
    depth = 0
    curr: list[str] = []
    for ch in body:
        if ch == "(":
            depth += 1
            curr.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            curr.append(ch)
        elif ch == "," and depth == 0:
            item = "".join(curr).strip()
            if item:
                c = _extract_col_name_from_add_clause(item)
                if c:
                    cols.add(c)
            curr = []
        else:
            curr.append(ch)
    last = "".join(curr).strip()
    if last:
        c = _extract_col_name_from_add_clause(last)
        if c:
            cols.add(c)
    return cols


def extract_temporary_tables(sql: str) -> dict[str, set[str]]:
    """
    Extract temporary tables:
    1. CREATE TABLE #temp ( col1 INT, col2 VARCHAR(50) )
    2. CREATE TEMP TABLE temp_name ( col1 INT, col2 TEXT )
    3. SELECT col1, col2, expr AS col3 INTO #temp FROM ...
    4. CREATE [TEMPORARY|TEMP] TABLE [IF NOT EXISTS] temp_name [(col1, col2)] AS SELECT ... (PostgreSQL)
    5. ALTER TABLE #temp ADD col INT / ALTER TABLE temp ADD col TEXT
    Returns mapping: '#temp' -> {'col1', 'col2', 'col3'}.
    """
    temp_tables: dict[str, set[str]] = {}

    # 1. CREATE TABLE #temp or CREATE TEMP TABLE temp
    create_pattern = re.compile(
        r"CREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([#@\w\.\"\[\]]+)\s*\(",
        re.IGNORECASE,
    )

    for match in create_pattern.finditer(sql):
        raw_name = match.group(1)
        clean_name = clean_identifier(raw_name).lower()
        # Accept if it starts with # (SQL Server temp table) or was declared with TEMP/TEMPORARY
        is_temp_keyword = bool(re.search(r"\b(?:TEMPORARY|TEMP)\b", sql[match.start():match.end()], re.IGNORECASE))
        if clean_name.startswith("#") or is_temp_keyword:
            start_idx = match.end() - 1
            depth = 0
            end_idx = -1
            for i in range(start_idx, len(sql)):
                if sql[i] == "(":
                    depth += 1
                elif sql[i] == ")":
                    depth -= 1
                    if depth == 0:
                        end_idx = i
                        break
            if end_idx != -1:
                body = sql[start_idx + 1:end_idx]
                cols = _extract_columns_from_parentheses_content(body)
                if cols:
                    temp_tables[clean_name] = cols

    # 2. SELECT ... INTO #temp
    # Match any INTO clause specifying a temporary table and scan backwards at depth 0 to find SELECT
    into_pattern = re.compile(
        r"\bINTO\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+)?([#@\w\.\"\[\]]+)",
        re.IGNORECASE,
    )
    for m in into_pattern.finditer(sql):
        raw_name = m.group(1)
        clean_name = clean_identifier(raw_name).lower()
        is_temp = clean_name.startswith("#") or "TEMP" in m.group(0).upper()
        if not is_temp:
            continue

        # Scan backwards at parenthesis depth 0 to locate the matching SELECT statement
        pos = m.start() - 1
        depth = 0
        sel_pos = -1
        while pos >= 0:
            ch = sql[pos]
            if ch == ")":
                depth += 1
                pos -= 1
                continue
            elif ch == "(":
                depth = max(0, depth - 1)
                pos -= 1
                continue
            elif depth == 0:
                if ch == ";":
                    break
                if ch.isalpha() or ch == "_":
                    w_end = pos + 1
                    while pos >= 0 and (sql[pos].isalnum() or sql[pos] in ("_", "@", "#", "$")):
                        pos -= 1
                    word = sql[pos + 1 : w_end].lower()
                    if word == "select":
                        sel_pos = pos + 1
                        break
                    elif word in ("union", "begin", "end", "go", "insert", "update", "delete", "create", "alter", "drop"):
                        break
                    continue
            pos -= 1

        if sel_pos != -1:
            proj_str = sql[sel_pos + 6 : m.start()].strip()
            clean_cols = _extract_columns_from_proj_str(proj_str)
            has_star = "*" in clean_cols
            clean_cols.discard("*")
            if has_star:
                m_from = re.search(r"\bFROM\s+([#@\w\.\"\[\]]+)", sql[m.end():], re.IGNORECASE)
                if m_from:
                    src_tbl = clean_identifier(m_from.group(1)).lower()
                    if src_tbl in temp_tables:
                        clean_cols.update(temp_tables[src_tbl])
            if clean_cols:
                if clean_name in temp_tables:
                    temp_tables[clean_name].update(clean_cols)
                else:
                    temp_tables[clean_name] = set(clean_cols)

    # 3. PostgreSQL: CREATE [GLOBAL|LOCAL] [TEMPORARY|TEMP] TABLE [IF NOT EXISTS] temp_name [(cols)] AS SELECT ...
    create_as_pattern = re.compile(
        r"\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+)(?:IF\s+NOT\s+EXISTS\s+)?([#@\w\.\"\[\]]+)\s*(?:\((.*?)\)\s*)?AS\s+(?:\(\s*)?SELECT\b\s+(.*?)(?=\b(?:FROM|WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|;|$))\b",
        re.IGNORECASE | re.DOTALL,
    )
    for m in create_as_pattern.finditer(sql):
        raw_name = m.group(1)
        clean_name = clean_identifier(raw_name).lower()
        explicit_cols_str = m.group(2)
        if explicit_cols_str:
            clean_cols = {clean_identifier(c).lower() for c in explicit_cols_str.split(",") if c.strip()}
        else:
            proj = m.group(3).strip()
            clean_cols = _extract_columns_from_proj_str(proj)
            has_star = "*" in clean_cols
            clean_cols.discard("*")
            if has_star:
                m_from = re.search(r"\bFROM\s+([#@\w\.\"\[\]]+)", sql[m.start():], re.IGNORECASE)
                if m_from:
                    src_tbl = clean_identifier(m_from.group(1)).lower()
                    if src_tbl in temp_tables:
                        clean_cols.update(temp_tables[src_tbl])
        if clean_cols:
            if clean_name in temp_tables:
                temp_tables[clean_name].update(clean_cols)
            else:
                temp_tables[clean_name] = set(clean_cols)

    # 4. ALTER TABLE #temp ADD / ALTER TABLE temp ADD
    alter_add_pattern = re.compile(
        r"\bALTER\s+TABLE\s+(?:ONLY\s+)?([#@\w\.\"\[\]]+)\s+ADD\s+(.*?)(?=\bALTER\b|\bDROP\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bEXEC\b|\bEXECUTE\b|\bGO\b|;|$)",
        re.IGNORECASE | re.DOTALL,
    )
    for m in alter_add_pattern.finditer(sql):
        raw_name = m.group(1)
        clean_name = clean_identifier(raw_name).lower()
        if clean_name.startswith("#") or clean_name in temp_tables:
            body = m.group(2)
            cols = _extract_columns_from_alter_add_body(body)
            if cols:
                if clean_name in temp_tables:
                    temp_tables[clean_name].update(cols)
                else:
                    temp_tables[clean_name] = set(cols)

    return temp_tables


@dataclass
class TempTableState:
    name: str
    columns: set[str] = field(default_factory=set)
    dropped_columns: set[str] = field(default_factory=set)
    is_open: bool = False
    is_dropped: bool = False
    created_at_pos: int = -1
    is_defined: bool = False


@dataclass
class TimelineEvent:
    pos: int
    event_type: str  # 'CREATE', 'CREATE_AS', 'SELECT_INTO', 'ALTER_ADD', 'ALTER_DROP', 'DROP', 'EXEC_OPEN'
    table_name: str  # lowercase clean name
    columns: set[str] = field(default_factory=set)
    extra: dict[str, Any] = field(default_factory=dict)


class TempTableTimeline:
    """
    Tracks lifecycle and structural mutations of temporary tables chronologically:
    CREATE, CREATE TEMP TABLE AS, SELECT INTO, ALTER TABLE ADD/DROP, DROP TABLE, and EXEC mutations.
    Implements Section 4 & 5 of .SKILL/temp_table_session_context_analysis.md.
    """

    def __init__(
        self,
        sql: str,
        sql_masked: str | None = None,
        dialect: str = "sqlserver",
        cached_tables_dict: dict[str, list[str]] | None = None,
        mutators: dict[str, dict] | None = None,
        declared_temp_tables: dict[str, set[str]] | None = None,
    ):
        self.sql = sql
        self.sql_masked = sql_masked if sql_masked is not None else sql
        self.dialect = dialect.lower()
        self.cached_tables_dict = cached_tables_dict or {}
        self.mutators = mutators or {}
        self.declared_temp_tables = declared_temp_tables or {}
        self.events: list[TimelineEvent] = []
        self._build_timeline()

    def has_table(self, table_name: str) -> bool:
        clean = clean_identifier(table_name).lower()
        return any(e.table_name == clean for e in self.events)

    def _build_timeline(self):
        sql = self.sql
        sql_masked = self.sql_masked

        # 1. CREATE TABLE #temp / CREATE TEMP TABLE t
        create_pattern = re.compile(
            r"\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([#@\w\.\"\[\]]+)\s*\(",
            re.IGNORECASE,
        )
        for m in create_pattern.finditer(sql_masked):
            raw_name = m.group(1)
            clean_name = clean_identifier(raw_name).lower()
            is_temp_kw = bool(re.search(r"\b(?:TEMPORARY|TEMP)\b", sql_masked[m.start():m.end()], re.IGNORECASE))
            if clean_name.startswith("#") or is_temp_kw:
                start_idx = m.end() - 1
                depth = 0
                end_idx = -1
                for i in range(start_idx, len(sql_masked)):
                    if sql_masked[i] == "(":
                        depth += 1
                    elif sql_masked[i] == ")":
                        depth -= 1
                        if depth == 0:
                            end_idx = i
                            break
                cols = set()
                if end_idx != -1:
                    body = sql[start_idx + 1:end_idx]
                    cols = self._extract_columns_from_parens(body)
                self.events.append(TimelineEvent(
                    pos=m.start(),
                    event_type="CREATE",
                    table_name=clean_name,
                    columns=cols
                ))

        # 1b. PostgreSQL: CREATE TEMP TABLE ... AS SELECT ...
        create_as_pattern = re.compile(
            r"\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+)(?:IF\s+NOT\s+EXISTS\s+)?([#@\w\.\"\[\]]+)\s*(?:\((.*?)\)\s*)?AS\s+(?:\(\s*)?SELECT\b\s+(.*?)(?=\b(?:FROM|WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|;|$))\b",
            re.IGNORECASE | re.DOTALL,
        )
        for m in create_as_pattern.finditer(sql_masked):
            raw_name = m.group(1)
            clean_name = clean_identifier(raw_name).lower()
            explicit_cols_str = m.group(2)
            source_tbl_name = ""
            if explicit_cols_str:
                clean_cols = {clean_identifier(c).lower() for c in explicit_cols_str.split(",") if c.strip()}
            else:
                proj = m.group(3).strip()
                cols = self._extract_projection_columns(proj)
                has_star = "*" in cols
                clean_cols = {c for c in cols if c and c != "*"}
                after_create = sql_masked[m.start():]
                m_from = re.search(r"\bFROM\s+([#@\w\.\"\[\]]+)", after_create, re.IGNORECASE)
                source_tbl_name = clean_identifier(m_from.group(1)).lower() if m_from else ""
                if has_star and source_tbl_name:
                    source_cols = set()
                    for prev_ev in self.events:
                        if prev_ev.table_name == source_tbl_name and prev_ev.pos < m.start():
                            if prev_ev.event_type in ("CREATE", "CREATE_AS", "SELECT_INTO"):
                                source_cols = set(prev_ev.columns)
                            elif prev_ev.event_type == "ALTER_ADD":
                                source_cols.update(prev_ev.columns)
                            elif prev_ev.event_type == "ALTER_DROP":
                                source_cols.difference_update(prev_ev.columns)
                            elif prev_ev.event_type == "MUTATOR_COPY":
                                source_cols.update(prev_ev.columns)
                    if not source_cols and self.cached_tables_dict:
                        for tbl_k, col_list in self.cached_tables_dict.items():
                            if tbl_k.lower() == source_tbl_name or tbl_k.lower().endswith("." + source_tbl_name):
                                source_cols = {c.lower() for c in col_list}
                                break
                    if source_cols:
                        clean_cols.update(source_cols)

            self.events.append(TimelineEvent(
                pos=m.start(),
                event_type="CREATE_AS",
                table_name=clean_name,
                columns=clean_cols,
                extra={"source_table": source_tbl_name}
            ))

        # 2. SELECT ... INTO #temp
        into_pattern = re.compile(
            r"\bINTO\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+)?([#@\w\.\"\[\]]+)",
            re.IGNORECASE,
        )
        for m in into_pattern.finditer(sql_masked):
            raw_name = m.group(1)
            clean_name = clean_identifier(raw_name).lower()
            is_temp = clean_name.startswith("#") or "TEMP" in m.group(0).upper()
            if not is_temp:
                continue
            pos = m.start() - 1
            depth = 0
            sel_pos = -1
            while pos >= 0:
                ch = sql_masked[pos]
                if ch == ")":
                    depth += 1
                elif ch == "(":
                    depth = max(0, depth - 1)
                elif depth == 0:
                    if ch == ";":
                        break
                    if ch.isalpha() or ch == "_":
                        w_end = pos + 1
                        while pos >= 0 and (sql_masked[pos].isalnum() or sql_masked[pos] in ("_", "@", "#", "$")):
                            pos -= 1
                        word = sql_masked[pos + 1:w_end].lower()
                        if word == "select":
                            sel_pos = pos + 1
                            break
                        elif word in ("union", "begin", "end", "go", "insert", "update", "delete", "create", "alter", "drop"):
                            break
                pos -= 1

            if sel_pos != -1:
                proj = sql[sel_pos + 6:m.start()].strip()
                cols = self._extract_projection_columns(proj)
                has_star = "*" in cols
                clean_cols = {c for c in cols if c and c != "*"}

                after_into = sql_masked[m.end():]
                m_from = re.search(r"\bFROM\s+([#@\w\.\"\[\]]+)", after_into, re.IGNORECASE)
                source_tbl_name = clean_identifier(m_from.group(1)).lower() if m_from else ""
                if has_star and source_tbl_name:
                    source_cols = set()
                    for prev_ev in self.events:
                        if prev_ev.table_name == source_tbl_name and prev_ev.pos < m.start():
                            if prev_ev.event_type in ("CREATE", "CREATE_AS", "SELECT_INTO"):
                                source_cols = set(prev_ev.columns)
                            elif prev_ev.event_type == "ALTER_ADD":
                                source_cols.update(prev_ev.columns)
                            elif prev_ev.event_type == "ALTER_DROP":
                                source_cols.difference_update(prev_ev.columns)
                            elif prev_ev.event_type == "MUTATOR_COPY":
                                source_cols.update(prev_ev.columns)
                    if not source_cols and self.cached_tables_dict:
                        for tbl_k, col_list in self.cached_tables_dict.items():
                            if tbl_k.lower() == source_tbl_name or tbl_k.lower().endswith("." + source_tbl_name):
                                source_cols = {c.lower() for c in col_list}
                                break
                    if source_cols:
                        clean_cols.update(source_cols)

                self.events.append(TimelineEvent(
                    pos=m.start(),
                    event_type="SELECT_INTO",
                    table_name=clean_name,
                    columns=clean_cols,
                    extra={"source_table": source_tbl_name}
                ))

        # 3. ALTER TABLE ... ADD ...
        alter_add_pattern = re.compile(
            r"\bALTER\s+TABLE\s+(?:ONLY\s+)?([#@\w\.\"\[\]]+)\s+ADD\s+(.*?)(?=\bALTER\b|\bDROP\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bEXEC\b|\bEXECUTE\b|\bGO\b|;|$)",
            re.IGNORECASE | re.DOTALL,
        )
        for m in alter_add_pattern.finditer(sql_masked):
            raw_name = m.group(1)
            clean_name = clean_identifier(raw_name).lower()
            body = sql[m.start(2):m.end(2)]
            added_cols = self._extract_columns_from_alter_add(body)
            if added_cols:
                self.events.append(TimelineEvent(
                    pos=m.start(),
                    event_type="ALTER_ADD",
                    table_name=clean_name,
                    columns=added_cols
                ))

        # 4. ALTER TABLE ... DROP COLUMN ...
        alter_drop_pattern = re.compile(
            r"\bALTER\s+TABLE\s+(?:ONLY\s+)?([#@\w\.\"\[\]]+)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(.*?)(?=\bALTER\b|\bADD\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bEXEC\b|\bEXECUTE\b|\bGO\b|;|$)",
            re.IGNORECASE | re.DOTALL,
        )
        for m in alter_drop_pattern.finditer(sql_masked):
            raw_name = m.group(1)
            clean_name = clean_identifier(raw_name).lower()
            body = sql[m.start(2):m.end(2)]
            dropped_cols = self._extract_columns_from_alter_drop(body)
            if dropped_cols:
                self.events.append(TimelineEvent(
                    pos=m.start(),
                    event_type="ALTER_DROP",
                    table_name=clean_name,
                    columns=dropped_cols
                ))

        # 5. DROP TABLE ...
        drop_pattern = re.compile(
            r"\b(?:IF\s+.*?\s+)?DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([#@\w\.\"\[\]]+)",
            re.IGNORECASE,
        )
        for m in drop_pattern.finditer(sql_masked):
            raw_name = m.group(1)
            clean_name = clean_identifier(raw_name).lower()
            self.events.append(TimelineEvent(
                pos=m.start(),
                event_type="DROP",
                table_name=clean_name
            ))

        # 6. EXEC / EXECUTE containing #temp name or dynamic SQL mentioning #temp
        # E.g. EXECUTE usp_sys_CreateTable N'#Kqt', @_Kqt
        # E.g. EXEC('ALTER TABLE #T ADD Extra INT')
        exec_pattern = re.compile(
            r"\b(?:EXEC|EXECUTE)(?:\s+([#@\w\.\"\[\]]+)|\s*\((.*?)\)|\s+(.*?))(?=\b(?:EXEC|EXECUTE|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GO)\b|;|$)",
            re.IGNORECASE | re.DOTALL,
        )

        mutator_map = {k.lower(): v for k, v in self.mutators.items()}
        if "usp_sys_createtable" not in mutator_map:
            mutator_map["usp_sys_createtable"] = {"target": 1, "copyColumnsFrom": 2}
        if "usp_sys_append" not in mutator_map:
            mutator_map["usp_sys_append"] = {"target": 2, "schemaChange": False}

        for m in exec_pattern.finditer(sql_masked):
            exec_full = sql[m.start():m.end()]

            # Check if this EXEC calls a recognized mutator procedure
            m_proc = re.match(
                r"^\s*(?:EXEC|EXECUTE)\s+(?:(?:dbo|sys|pg_catalog)\.)?([a-zA-Z_#$][a-zA-Z0-9_#$]*)",
                exec_full,
                re.IGNORECASE,
            )
            proc_name = clean_identifier(m_proc.group(1)).lower() if m_proc else ""
            mutator_cfg = mutator_map.get(proc_name) if proc_name else None

            if mutator_cfg is not None:
                if mutator_cfg.get("schemaChange") is False:
                    # Procedure does not alter schema of temp table (Section 5.3)
                    continue

                target_idx = mutator_cfg.get("target", 1)
                copy_from_idx = mutator_cfg.get("copyColumnsFrom")

                # Parse arguments after procedure name
                args_str = exec_full[m_proc.end():]
                args = []
                depth = 0
                in_quote = False
                buf = []
                for ch in args_str:
                    if ch == "'":
                        in_quote = not in_quote
                        buf.append(ch)
                    elif ch == "(" and not in_quote:
                        depth += 1
                        buf.append(ch)
                    elif ch == ")" and not in_quote:
                        depth = max(0, depth - 1)
                        buf.append(ch)
                    elif ch == "," and depth == 0 and not in_quote:
                        args.append("".join(buf).strip())
                        buf = []
                    else:
                        buf.append(ch)
                if buf:
                    args.append("".join(buf).strip())

                target_arg = args[target_idx - 1] if len(args) >= target_idx else ""
                m_target_temp = re.search(r"#[a-zA-Z0-9_#$]+", target_arg)
                clean_target = clean_identifier(m_target_temp.group(0)).lower() if m_target_temp else ""

                if clean_target and copy_from_idx and len(args) >= copy_from_idx:
                    source_arg = args[copy_from_idx - 1].strip()
                    source_table_name = ""
                    m_lit = re.search(r"N?'([^']+)'", source_arg)
                    if m_lit:
                        source_table_name = clean_identifier(m_lit.group(1)).lower()
                    elif source_arg.startswith("@"):
                        var_name = clean_identifier(source_arg)
                        m_var_val = re.search(
                            rf"\b(?:DECLARE\s+{re.escape(var_name)}\s+[^=]*=\s*|SET\s+{re.escape(var_name)}\s*=\s*|{re.escape(var_name)}\s+[^=]*=\s*)N?'([^']+)'",
                            sql,
                            re.IGNORECASE,
                        )
                        if m_var_val:
                            source_table_name = clean_identifier(m_var_val.group(1)).lower()

                    copied_cols = set()
                    if source_table_name and self.cached_tables_dict:
                        for k, v in self.cached_tables_dict.items():
                            norm_k = re.sub(r"[\[\]\"`]", "", k).strip().lower()
                            if norm_k == source_table_name or norm_k.endswith(f".{source_table_name}"):
                                copied_cols = {clean_identifier(c).lower() for c in v}
                                break

                    if copied_cols:
                        self.events.append(TimelineEvent(
                            pos=m.start(),
                            event_type="MUTATOR_COPY",
                            table_name=clean_target,
                            columns=copied_cols,
                            extra={"is_open": False, "source_table": source_table_name}
                        ))
                        continue
                    else:
                        self.events.append(TimelineEvent(
                            pos=m.start(),
                            event_type="EXEC_OPEN",
                            table_name=clean_target,
                            extra={"source_table": source_table_name}
                        ))
                        continue

            # Default: scan for string literals mentioning #temp
            str_literals = re.findall(r"N?'(.*?)'", exec_full, re.DOTALL)
            for s in str_literals:
                temp_matches = re.findall(r"#[a-zA-Z0-9_#$]+", s)
                for tm in temp_matches:
                    clean_tm = clean_identifier(tm).lower()
                    self.events.append(TimelineEvent(
                        pos=m.start(),
                        event_type="EXEC_OPEN",
                        table_name=clean_tm
                    ))

        # 7. Global temp tables ##G: if EXEC happens anywhere in the script, mark ##G open
        has_any_exec = bool(exec_pattern.search(sql_masked))
        if has_any_exec:
            for ev in list(self.events):
                if ev.table_name.startswith("##") and ev.event_type == "CREATE":
                    self.events.append(TimelineEvent(
                        pos=ev.pos + 1,
                        event_type="EXEC_OPEN",
                        table_name=ev.table_name
                    ))

        # 8. Cross-procedure and Routine Scope Handling
        # PostgreSQL: Temp tables survive routine execution; when a procedure is called via CALL or PERFORM,
        # its temp tables are created in the active session and become visible to the caller.
        # SQL Server: Local #temp tables created inside a stored procedure are automatically dropped when that
        # procedure finishes (at routine end); caller procedures or outer scripts CANNOT access them.
        routine_pattern = re.compile(
            r"\b(?:CREATE|ALTER)(?:\s+OR\s+(?:REPLACE|ALTER))?\s+(PROCEDURE|PROC|FUNCTION|FUNC|TRIGGER)\s+(?:(?:([a-zA-Z_#$][a-zA-Z0-9_#$]*)\.)?([a-zA-Z_#$][a-zA-Z0-9_#$]*))",
            re.IGNORECASE,
        )
        routines = []
        routine_map = {}
        for m_rtn in routine_pattern.finditer(sql_masked):
            r_type = m_rtn.group(1).lower()
            r_schema = (m_rtn.group(2) or "").lower()
            r_name = clean_identifier(m_rtn.group(3) or "").lower()
            if not r_name:
                continue
            full_name = f"{r_schema}.{r_name}" if r_schema else r_name
            r_start = m_rtn.start()

            after_rtn = sql_masked[m_rtn.end():]
            m_dollar = re.search(r"(\$[a-zA-Z0-9_]*\$)", after_rtn)
            r_end = len(sql_masked)
            if m_dollar and m_dollar.start() < 250:
                tag = m_dollar.group(1)
                tag_start = m_rtn.end() + m_dollar.start()
                close_pos = sql_masked.find(tag, tag_start + len(tag))
                if close_pos != -1:
                    r_end = close_pos + len(tag)
                    m_semi = re.match(r"\s*;", sql_masked[r_end:])
                    if m_semi:
                        r_end += m_semi.end()
            else:
                m_go = re.search(r"\bGO\b", after_rtn, re.IGNORECASE)
                m_next_create = re.search(r"\b(?:CREATE|ALTER)\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:PROCEDURE|PROC|FUNCTION|FUNC|TRIGGER)\b", after_rtn, re.IGNORECASE)

                depth = 0
                has_begin = False
                end_pos = -1
                for m_block in re.finditer(r"\b(BEGIN|END)\b", after_rtn, re.IGNORECASE):
                    kw = m_block.group(1).upper()
                    if kw == "BEGIN":
                        depth += 1
                        has_begin = True
                    elif kw == "END":
                        if depth > 0:
                            depth -= 1
                            if has_begin and depth == 0:
                                end_pos = m_rtn.end() + m_block.end()
                                m_semi = re.match(r"\s*;", sql_masked[end_pos:])
                                if m_semi:
                                    end_pos += m_semi.end()
                                break

                candidate_ends = [len(sql_masked)]
                if m_go:
                    candidate_ends.append(m_rtn.end() + m_go.start())
                if m_next_create:
                    candidate_ends.append(m_rtn.end() + m_next_create.start())
                if end_pos != -1:
                    candidate_ends.append(end_pos)
                r_end = min(candidate_ends)

            rtn_info = {
                "name": r_name,
                "fullName": full_name,
                "schema": r_schema,
                "start": r_start,
                "end": r_end,
                "temp_tables": [],
                "called_routines": []
            }
            routines.append(rtn_info)
            routine_map[r_name] = rtn_info
            if full_name != r_name:
                routine_map[full_name] = rtn_info

        # Track which temp tables were declared in which routine
        for ev in list(self.events):
            if ev.event_type in ("CREATE", "CREATE_AS", "SELECT_INTO", "MUTATOR_COPY"):
                for r in routines:
                    if r["start"] <= ev.pos <= r["end"]:
                        r["temp_tables"].append((ev.table_name, set(ev.columns)))

        is_postgres = (
            ("postgres" in self.dialect)
            or ("pgsql" in self.dialect)
            or ("$$" in sql_masked)
        )
        is_sqlserver = (
            ("sqlserver" in self.dialect)
            or ("mssql" in self.dialect)
            or ("tsql" in self.dialect)
            or (not is_postgres and ("GO" in sql_masked or "#" in sql_masked or "@" in sql_masked))
        )

        call_pattern = re.compile(
            r"\b(?:CALL|PERFORM)\s+(?:(?:([a-zA-Z_#$][a-zA-Z0-9_#$]*)\.)?([a-zA-Z_#$][a-zA-Z0-9_#$]*))",
            re.IGNORECASE,
        )

        # Detect called routines inside routines
        for m_call in call_pattern.finditer(sql_masked):
            c_pos = m_call.start()
            c_schema = (m_call.group(1) or "").lower()
            c_name = clean_identifier(m_call.group(2) or "").lower()
            c_full = f"{c_schema}.{c_name}" if c_schema else c_name
            enc_rtn = next((r for r in routines if r["start"] <= c_pos <= r["end"]), None)
            if enc_rtn:
                enc_rtn["called_routines"].append(c_name)
                if c_full != c_name:
                    enc_rtn["called_routines"].append(c_full)

        def get_exported_temp_tables(rtn_name, visited=None):
            if visited is None:
                visited = set()
            norm = rtn_name.lower().strip()
            if not norm or norm in visited:
                return []
            visited.add(norm)
            r = routine_map.get(norm) or (routine_map.get(norm.split(".")[-1]) if "." in norm else None)
            if not r:
                return []
            res = list(r["temp_tables"])
            for child in r["called_routines"]:
                res.extend(get_exported_temp_tables(child, visited))
            return res

        # In PostgreSQL: export temp tables upon CALL or PERFORM
        if is_postgres:
            for m_call in call_pattern.finditer(sql_masked):
                c_pos = m_call.start()
                c_name = clean_identifier(m_call.group(2) or "").lower()
                exported = get_exported_temp_tables(c_name)
                for tbl_name, tbl_cols in exported:
                    self.events.append(TimelineEvent(
                        pos=c_pos,
                        event_type="CREATE",
                        table_name=tbl_name,
                        columns=set(tbl_cols)
                    ))

        # Routines define procedure bodies; local temp tables declared within routine bodies
        # are not in the session scope until called. Mark them dropped at routine definition end.
        for r in routines:
            seen_dropped = set()
            for tbl_name, _ in r["temp_tables"]:
                if tbl_name not in seen_dropped and not tbl_name.startswith("##"):
                    seen_dropped.add(tbl_name)
                    self.events.append(TimelineEvent(
                        pos=r["end"],
                        event_type="DROP",
                        table_name=tbl_name
                    ))

        # Sort all events chronologically by pos
        self.events.sort(key=lambda e: e.pos)

    def _extract_columns_from_parens(self, body: str) -> set[str]:
        cols = set()
        depth = 0
        curr = []
        for ch in body:
            if ch == "(":
                depth += 1
                curr.append(ch)
            elif ch == ")":
                depth = max(0, depth - 1)
                curr.append(ch)
            elif ch == "," and depth == 0:
                item = "".join(curr).strip()
                if item:
                    c = self._extract_col_name(item)
                    if c:
                        cols.add(c)
                curr = []
            else:
                curr.append(ch)
        last = "".join(curr).strip()
        if last:
            c = self._extract_col_name(last)
            if c:
                cols.add(c)
        return cols

    def _extract_columns_from_alter_add(self, body: str) -> set[str]:
        return _extract_columns_from_alter_add_body(body)

    def _extract_col_name_from_add(self, item: str) -> str:
        return _extract_col_name_from_add_clause(item)

    def _extract_columns_from_alter_drop(self, body: str) -> set[str]:
        cols = set()
        for chunk in body.split(","):
            chunk = chunk.strip()
            chunk = re.sub(r"^\s*COLUMN\s+(?:IF\s+EXISTS\s+)?", "", chunk, flags=re.IGNORECASE).strip()
            m = re.match(r"^(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))", chunk)
            if m:
                raw = m.group(1) or m.group(2) or m.group(3)
                cols.add(clean_identifier(raw).lower())
        return cols

    def _extract_col_name(self, item: str) -> str:
        item = item.strip()
        if not item or re.match(r"^\s*(?:CONSTRAINT|PRIMARY|FOREIGN|CHECK|UNIQUE|INDEX)\b", item, re.IGNORECASE):
            return ""
        m = re.match(r"^(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))", item)
        if m:
            raw = m.group(1) or m.group(2) or m.group(3)
            return clean_identifier(raw).lower()
        return ""

    def _extract_projection_columns(self, proj_str: str) -> set[str]:
        return _extract_columns_from_proj_str(proj_str)

    def get_table_state(self, table_name: str, at_pos: int) -> TempTableState:
        clean_name = clean_identifier(table_name).lower()
        state = TempTableState(name=clean_name)

        if clean_name.startswith("##"):
            state.is_open = True
            state.is_defined = True

        relevant_events = [e for e in self.events if e.table_name == clean_name and e.pos <= at_pos]
        if not relevant_events:
            future = [e for e in self.events if e.table_name == clean_name and e.event_type in ("CREATE", "CREATE_AS", "SELECT_INTO") and e.pos > at_pos]
            if future:
                state.created_at_pos = future[0].pos
                state.is_defined = False
                return state
            if clean_name.startswith("##"):
                return state
            return state

        for ev in relevant_events:
            if ev.event_type in ("CREATE", "CREATE_AS", "SELECT_INTO"):
                state.columns = set(ev.columns)
                state.is_open = False
                state.is_dropped = False
                state.created_at_pos = ev.pos
                state.is_defined = True
            elif ev.event_type == "ALTER_ADD":
                state.columns.update(ev.columns)
            elif ev.event_type == "ALTER_DROP":
                state.columns.difference_update(ev.columns)
                state.dropped_columns.update(ev.columns)
            elif ev.event_type == "DROP":
                state.is_dropped = True
                state.is_defined = False
                state.columns.clear()
            elif ev.event_type == "EXEC_OPEN":
                state.is_open = True
                state.is_defined = True
            elif ev.event_type == "MUTATOR_COPY":
                state.columns.update(ev.columns)
                state.is_defined = True
                if ev.extra.get("is_open"):
                    state.is_open = True

        return state


def extract_ctes(sql: str) -> dict[str, set[str]]:
    """
    Extract CTE definitions:
    WITH cte_name (c1, c2) AS (...)
    WITH cte_name AS (SELECT c1, expr AS c2 FROM ...)
    WITH cte_name AS (SELECT 1 AS c1, 'val' AS c2)
    Supports multiple chained CTEs.
    """
    ctes: dict[str, set[str]] = {}

    cte_pattern = re.compile(
        r"(?:WITH|,)\s+(?:\[([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\]|\"([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\"|([a-zA-Z_][a-zA-Z0-9_]*))\s*(?:\((.*?)\))?\s*AS\s*\(",
        re.IGNORECASE,
    )

    for m in cte_pattern.finditer(sql):
        cte_name = clean_identifier(m.group(1) or m.group(2) or m.group(3)).lower()
        explicit_cols_str = m.group(4)
        if explicit_cols_str:
            cols = {clean_identifier(c).lower() for c in explicit_cols_str.split(",") if c.strip()}
            if cols:
                ctes[cte_name] = cols
                continue

        # Balanced parentheses scan to find CTE inner query
        start_idx = m.end() - 1  # points to '('
        depth = 0
        end_idx = -1
        for i in range(start_idx, len(sql)):
            if sql[i] == "(":
                depth += 1
            elif sql[i] == ")":
                depth -= 1
                if depth == 0:
                    end_idx = i
                    break

        if end_idx != -1:
            body = sql[start_idx + 1:end_idx].strip()
            # Strip block and line comments from CTE body before parsing projection
            body_no_comments = re.sub(r"/\*.*?\*/", " ", body, flags=re.DOTALL)
            body_no_comments = re.sub(r"--.*$", " ", body_no_comments, flags=re.MULTILINE).strip()
            # Extract projection before FROM (or entire projection if no FROM)
            sel_m = re.match(r"^\s*SELECT\s+(.*?)(?:\s+FROM\b.*|$)", body_no_comments, re.IGNORECASE | re.DOTALL)
            if sel_m:
                proj_str = sel_m.group(1)
                clean_cols = {c for c in _extract_columns_from_proj_str(proj_str) if c and c != "*"}
                if clean_cols:
                    ctes[cte_name] = clean_cols

    return ctes


def get_temp_table_columns_from_db(
    connection_session: Any,
    dialect: str,
    table_name: str,
) -> set[str] | None:
    """
    Retrieve columns of a temporary table directly from database session:
    - SQL Server: tempdb.sys.columns via OBJECT_ID('tempdb..#temp') or session name pattern
    - PostgreSQL: pg_catalog.pg_attribute in pg_temp / pg_temp_% schemas
    """
    if not connection_session or not table_name:
        return None
    raw_connection = None
    if getattr(connection_session, "adapter", None):
        raw_connection = getattr(connection_session.adapter, "connection", None)
    if not raw_connection:
        return None

    clean_tbl = clean_identifier(table_name).lower()
    norm_dialect = "postgres" if ("postgres" in dialect.lower() or "pgsql" in dialect.lower() or dialect.lower() == "pg") else "sqlserver"
    conn_id = str(getattr(connection_session, "connection_id", "") or "").lower()

    # Check cache first
    cache_key = (conn_id, norm_dialect, "", "tempdb", "dbo", clean_tbl)
    cached = _get_cached_columns(cache_key)
    if cached is not None:
        return cached

    session_lock = getattr(connection_session, "lock", None)
    lock_acquired = False
    if session_lock is not None:
        try:
            lock_acquired = session_lock.acquire(timeout=0.6)
            if not lock_acquired:
                return None
        except Exception:
            return None

    try:
        cursor = raw_connection.cursor()
        try:
            if norm_dialect == "sqlserver":
                temp_name = clean_tbl if clean_tbl.startswith("#") else f"#{clean_tbl}"
                # Query by OBJECT_ID('tempdb..#temp') strictly in current session (T7 fix)
                query = """
                    SELECT c.name
                    FROM tempdb.sys.columns c
                    WHERE c.object_id = OBJECT_ID('tempdb..' + ?)
                """
                cursor.execute(query, (temp_name,))
                rows = cursor.fetchall()
                if rows:
                    cols = {clean_identifier(r[0]).lower() for r in rows if r and r[0]}
                    _set_cached_columns(cache_key, cols)
                    return cols
            else:
                # PostgreSQL temporary tables live in current backend's temp schema (T8 fix)
                query = """
                    SELECT a.attname
                    FROM pg_catalog.pg_attribute a
                    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE LOWER(c.relname) = LOWER(%s)
                      AND (n.oid = pg_my_temp_schema() OR n.nspname = 'pg_temp')
                      AND a.attnum > 0 AND NOT a.attisdropped
                """
                cursor.execute(query, (clean_tbl,))
                rows = cursor.fetchall()
                if rows:
                    cols = {clean_identifier(r[0]).lower() for r in rows if r and r[0]}
                    _set_cached_columns(cache_key, cols)
                    return cols
        finally:
            try:
                cursor.close()
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"[SemanticCheck] get_temp_table_columns_from_db error: {e}")
    finally:
        if lock_acquired and session_lock is not None:
            try:
                session_lock.release()
            except Exception:
                pass

    return None


def get_physical_table_columns(
    connection_session: Any,
    dialect: str,
    database: str | None,
    schema: str | None,
    table_name: str,
    cached_tables_dict: dict[str, list[str]] | None = None,
    server: str | None = None,
) -> set[str] | None:
    """
    Retrieve columns for a physical table from:
    1. In-memory cache (_PHYSICAL_TABLE_COLUMNS_CACHE)
    2. Client-provided cached_tables_dict (from MetadataCache)
    3. Active connection session (via metadata query or sp_columns_ex for linked servers)
    """
    clean_tbl = clean_identifier(table_name).lower()
    clean_schema = clean_identifier(schema or "").lower()
    clean_db = clean_identifier(database or "").lower()
    clean_server = clean_identifier(server or "").lower()
    norm_dialect = "postgres" if ("postgres" in dialect.lower() or "pgsql" in dialect.lower() or dialect.lower() == "pg") else "sqlserver"

    # Check client-provided cache first (matches simple table name, schema.table, or multipart)
    if cached_tables_dict:
        candidate_keys = set()
        if clean_schema:
            candidate_keys.add(f"{clean_schema}.{clean_tbl}")
            if clean_db:
                candidate_keys.add(f"{clean_db}.{clean_schema}.{clean_tbl}")
                if clean_server:
                    candidate_keys.add(f"{clean_server}.{clean_db}.{clean_schema}.{clean_tbl}")
        else:
            candidate_keys.add(clean_tbl)
            candidate_keys.add(f"dbo.{clean_tbl}")
            candidate_keys.add(f"public.{clean_tbl}")
            if clean_db:
                candidate_keys.add(f"{clean_db}.{clean_tbl}")
                candidate_keys.add(f"{clean_db}.dbo.{clean_tbl}")

        for k, col_list in cached_tables_dict.items():
            norm_k = re.sub(r"[\[\]\"`]", "", k).strip().lower()
            if norm_k in candidate_keys:
                cols = {clean_identifier(c).lower() for c in col_list}
                if cols:
                    return cols

    conn_id = str(getattr(connection_session, "connection_id", "") or "").lower()

    # Check process in-memory cache
    cache_key = (conn_id, norm_dialect, clean_server, clean_db, clean_schema, clean_tbl)
    cached = _get_cached_columns(cache_key)
    if cached is not None:
        return cached
    simple_key = (conn_id, norm_dialect, clean_server, "", "", clean_tbl)
    if not clean_schema:
        cached_simple = _get_cached_columns(simple_key)
        if cached_simple is not None:
            return cached_simple

    def _save_to_cache(cols_set: set[str]) -> set[str]:
        _set_cached_columns(cache_key, cols_set)
        if not clean_schema:
            _set_cached_columns(simple_key, cols_set)
        return cols_set

    # Check connection_session.metadata_cache before attempting connection lock
    if connection_session:
        meta_cache = getattr(connection_session, "metadata_cache", None)
        if isinstance(meta_cache, dict):
            for k, v in meta_cache.items():
                if ("column" in k.lower() or "intellisense" in k.lower()) and k.lower().endswith(f"::{clean_tbl}"):
                    if isinstance(v, list) and v:
                        cols = {clean_identifier(c.get("name", str(c))).lower() for c in v if (isinstance(c, dict) and c.get("name")) or isinstance(c, str)}
                        if cols:
                            return _save_to_cache(cols)

    # Without connection session, cannot query live DB
    if not connection_session or not getattr(connection_session, "adapter", None):
        return None

    # Check metadata_service if available
    meta_service = getattr(connection_session, "metadata_service", None)
    if meta_service:
        try:
            if clean_server and hasattr(meta_service, "list_remote_columns"):
                items = meta_service.list_remote_columns(clean_server, clean_db or None, clean_schema or None, clean_tbl)
                if items:
                    cols = {clean_identifier(c.get("name", "")).lower() for c in items if c and c.get("name")}
                    if cols:
                        return _save_to_cache(cols)
            if hasattr(meta_service, "get_intellisense_columns"):
                items = meta_service.get_intellisense_columns(clean_db or database or None, clean_schema or schema or None, clean_tbl)
                if items:
                    cols = {clean_identifier(c.get("name", "")).lower() for c in items if c and c.get("name")}
                    if cols:
                        return _save_to_cache(cols)
        except Exception as e:
            logger.debug(f"[SemanticCheck] metadata_service lookup error: {e}")

    adapter = connection_session.adapter
    session_lock = getattr(connection_session, "lock", None)
    lock_acquired = False
    if session_lock is not None:
        try:
            lock_acquired = session_lock.acquire(timeout=0.6)
            if not lock_acquired:
                return None
        except Exception:
            pass

    try:
        raw_conn = getattr(adapter, "connection", None)

        # Method 1a: Linked Server Query (SQL Server 4-part name)
        if clean_server and norm_dialect == "sqlserver" and raw_conn:
            try:
                cursor = raw_conn.cursor()
                cursor.execute(
                    "EXEC sp_columns_ex @table_server = ?, @table_name = ?, @table_schema = ?, @table_catalog = ?",
                    (clean_identifier(server), clean_tbl, clean_schema or None, clean_db or None),
                )
                rows = cursor.fetchall()
                if rows:
                    cols = {clean_identifier(r[3]).lower() for r in rows if len(r) > 3 and r[3]}
                    if cols:
                        return _save_to_cache(cols)
            except Exception as e:
                logger.debug(f"[SemanticCheck] sp_columns_ex failed for linked server {clean_server}: {e}")
            finally:
                try:
                    cursor.close()
                except Exception:
                    pass

        # Method 1b: Try table child columns via adapter
        if hasattr(adapter, "list_object_children"):
            try:
                target_sch = clean_schema or schema or ("dbo" if norm_dialect == "sqlserver" else "public")
                target_database = clean_db or database
                children = adapter.list_object_children(
                    database=target_database,
                    schema=target_sch,
                    name=clean_tbl,
                    object_type="table",
                    child_type="columns",
                )
                if not children:
                    children = adapter.list_object_children(
                        database=target_database,
                        schema=None,
                        name=clean_tbl,
                        object_type="table",
                        child_type="columns",
                    )
                if not children:
                    # Try view child columns
                    children = adapter.list_object_children(
                        database=target_database,
                        schema=target_sch,
                        name=clean_tbl,
                        object_type="view",
                        child_type="columns",
                    )
                if children:
                    cols = {clean_identifier(c.get("name", "")).lower() for c in children if c.get("name")}
                    if cols:
                        return _save_to_cache(cols)
            except Exception as e:
                logger.debug(f"[SemanticCheck] list_object_children query failed: {e}")

        # Method 2: Direct information schema or catalog query
        if raw_conn:
            cursor = raw_conn.cursor()
            try:
                if norm_dialect == "sqlserver":
                    db_prefix = f"[{database}]." if database else ""
                    query = f"""
                        SELECT c.name
                        FROM {db_prefix}sys.columns c
                        JOIN {db_prefix}sys.objects o ON o.object_id = c.object_id
                        JOIN {db_prefix}sys.schemas s ON s.schema_id = o.schema_id
                        WHERE LOWER(o.name) = LOWER(?)
                          AND (? IS NULL OR ? = '' OR LOWER(s.name) = LOWER(?))
                    """
                    target_schema = clean_schema or schema or "dbo"
                    cursor.execute(query, (clean_tbl, target_schema, target_schema, target_schema))
                    rows = cursor.fetchall()
                    if not rows:
                        cursor.execute(
                            f"SELECT c.name FROM {db_prefix}sys.columns c JOIN {db_prefix}sys.objects o ON o.object_id = c.object_id WHERE LOWER(o.name) = LOWER(?)",
                            (clean_tbl,)
                        )
                        rows = cursor.fetchall()
                    if rows:
                        cols = {clean_identifier(r[0]).lower() for r in rows if r and r[0]}
                        return _save_to_cache(cols)
                    # Fallback to INFORMATION_SCHEMA
                    info_query = f"""
                        SELECT COLUMN_NAME
                        FROM {db_prefix}INFORMATION_SCHEMA.COLUMNS
                        WHERE LOWER(TABLE_NAME) = LOWER(?)
                    """
                    cursor.execute(info_query, (clean_tbl,))
                    info_rows = cursor.fetchall()
                    if info_rows:
                        cols = {clean_identifier(r[0]).lower() for r in info_rows if r and r[0]}
                        return _save_to_cache(cols)
                else:
                    # PostgreSQL
                    query = """
                        SELECT a.attname
                        FROM pg_catalog.pg_attribute a
                        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE LOWER(c.relname) = LOWER(%s)
                          AND (n.nspname = %s OR lower(n.nspname) = lower(%s) OR %s IS NULL OR %s = '')
                          AND a.attnum > 0 AND NOT a.attisdropped
                    """
                    target_schema = clean_schema or schema or "public"
                    cursor.execute(query, (clean_tbl, target_schema, target_schema, target_schema, target_schema))
                    rows = cursor.fetchall()
                    if rows:
                        cols = {clean_identifier(r[0]).lower() for r in rows if r and r[0]}
                        return _save_to_cache(cols)
                    # Fallback to information_schema
                    info_query = """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE LOWER(table_name) = LOWER(%s)
                          AND (table_schema = %s OR lower(table_schema) = lower(%s) OR %s IS NULL OR %s = '')
                    """
                    cursor.execute(info_query, (clean_tbl, target_schema, target_schema, target_schema, target_schema))
                    info_rows = cursor.fetchall()
                    if info_rows:
                        cols = {clean_identifier(r[0]).lower() for r in info_rows if r and r[0]}
                        return _save_to_cache(cols)
            except Exception as e:
                logger.debug(f"[SemanticCheck] direct column catalog query failed: {e}")
            finally:
                try:
                    cursor.close()
                except Exception:
                    pass

    except Exception as exc:
        logger.debug(f"[SemanticCheck] get_physical_table_columns error: {exc}")
    finally:
        if lock_acquired and session_lock is not None:
            try:
                session_lock.release()
            except Exception:
                pass

    return None


def mask_sql_literals_and_comments(sql: str) -> str:
    """
    Mask single-quoted string literals and comments with spaces,
    preserving exact line numbers and column offsets.
    Also handles N'...' Unicode literals properly.
    """
    result = list(sql)
    n = len(sql)
    i = 0
    in_single_quote = False
    in_line_comment = False
    in_block_comment = False

    while i < n:
        if in_single_quote:
            if sql[i] == "'":
                if i + 1 < n and sql[i + 1] == "'":
                    result[i] = ' '
                    result[i + 1] = ' '
                    i += 2
                    continue
                else:
                    result[i] = ' '
                    in_single_quote = False
                    i += 1
                    continue
            else:
                if sql[i] != '\n' and sql[i] != '\r':
                    result[i] = ' '
                i += 1
                continue

        if in_line_comment:
            if sql[i] == '\n':
                in_line_comment = False
            else:
                if sql[i] != '\r':
                    result[i] = ' '
            i += 1
            continue

        if in_block_comment:
            if sql[i] == '*' and i + 1 < n and sql[i + 1] == '/':
                result[i] = ' '
                result[i + 1] = ' '
                in_block_comment = False
                i += 2
                continue
            else:
                if sql[i] != '\n' and sql[i] != '\r':
                    result[i] = ' '
                i += 1
                continue

        # Check comment starts
        if sql[i] == '-' and i + 1 < n and sql[i + 1] == '-':
            result[i] = ' '
            result[i + 1] = ' '
            in_line_comment = True
            i += 2
            continue

        if sql[i] == '/' and i + 1 < n and sql[i + 1] == '*':
            result[i] = ' '
            result[i + 1] = ' '
            in_block_comment = True
            i += 2
            continue

        # Check string literals (including N'...')
        if sql[i] == "'":
            result[i] = ' '
            in_single_quote = True
            i += 1
            continue

        if (sql[i] == 'N' or sql[i] == 'n') and i + 1 < n and sql[i + 1] == "'":
            result[i] = ' '
            result[i + 1] = ' '
            in_single_quote = True
            i += 2
            continue

        i += 1

    return "".join(result)


def strip_subqueries(text: str) -> str:
    """
    Mask any nested subquery (SELECT ...) with spaces, preserving exact character positions and line numbers.
    Prevents inner subquery column references from being falsely attributed to the outer query's table.
    """
    if not text or "SELECT" not in text.upper():
        return text
    result = list(text)
    n = len(text)
    i = 0
    while i < n:
        if text[i] == '(':
            start = i
            depth = 1
            i += 1
            sub_text_start = i
            while i < n and depth > 0:
                if text[i] == '(':
                    depth += 1
                elif text[i] == ')':
                    depth -= 1
                i += 1
            inner = text[sub_text_start:i-1]
            if re.search(r"\bSELECT\b", inner, re.IGNORECASE):
                for k in range(start, i):
                    if result[k] != '\n':
                        result[k] = ' '
        else:
            i += 1
    return "".join(result)


STATEMENT_BREAK_KEYWORDS = {
    "select", "insert", "update", "delete", "merge",
    "create", "alter", "drop", "truncate",
    "exec", "execute", "declare", "set", "print",
    "if", "else", "begin", "end", "while", "return",
    "throw", "raiserror", "fetch", "open", "close", "deallocate",
    "grant", "revoke", "deny", "backup", "restore", "use", "go"
}


def _extract_derived_columns(
    inner_sql: str,
    local_tables: dict[str, set[str]],
    cached_tables_dict: dict[str, list[str]] | None = None,
) -> set[str]:
    """Extract projected column names from an inner derived subquery SQL."""
    m = re.search(r"\bSELECT\b\s+(.*?)\s+\bFROM\b", inner_sql, re.IGNORECASE | re.DOTALL)
    if not m:
        return set()
    proj_str = m.group(1).strip()
    cols: set[str] = set()

    depth = 0
    curr: list[str] = []
    items: list[str] = []
    for ch in proj_str:
        if ch == '(':
            depth += 1
            curr.append(ch)
        elif ch == ')':
            depth = max(0, depth - 1)
            curr.append(ch)
        elif ch == ',' and depth == 0:
            it = "".join(curr).strip()
            if it:
                items.append(it)
            curr = []
        else:
            curr.append(ch)
    last_it = "".join(curr).strip()
    if last_it:
        items.append(last_it)

    for it in items:
        col_name = _extract_projection_column_name(it)
        if col_name:
            if col_name == "*":
                m_from = re.search(r"\bFROM\s+([#@\w\.\"\[\]]+)", inner_sql, re.IGNORECASE)
                if m_from:
                    from_tbl = clean_identifier(m_from.group(1)).lower()
                    if from_tbl in local_tables:
                        cols.update(local_tables[from_tbl])
                    elif cached_tables_dict:
                        for k, v in cached_tables_dict.items():
                            norm_k = re.sub(r"[\[\]\"`]", "", k).strip().lower()
                            if norm_k == from_tbl or norm_k.endswith(f".{from_tbl}"):
                                cols.update({clean_identifier(c).lower() for c in v})
                                break
            else:
                cols.add(col_name)
    return cols


def extract_select_query_blocks(sql_masked: str, sql_raw: str):
    """
    Extract SELECT ... FROM query blocks accurately without crossing statement boundaries.
    Yields (proj_str, raw_table_name, raw_alias, rest_of_query, sel_start, sel_end)
    """
    n = len(sql_masked)
    i = 0
    select_finder = re.compile(r"\bSELECT\b", re.IGNORECASE)

    while i < n:
        m_sel = select_finder.search(sql_masked, i)
        if not m_sel:
            break

        sel_start = m_sel.start()
        pos = m_sel.end()

        # Scan forward to find FROM at depth 0
        depth = 0
        found_from = False
        from_pos = -1
        statement_ended = False

        while pos < n:
            ch = sql_masked[pos]
            if ch == '(':
                depth += 1
                pos += 1
                continue
            elif ch == ')':
                if depth > 0:
                    depth -= 1
                    pos += 1
                    continue
                else:
                    statement_ended = True
                    break
            elif ch == ';' or (ch == '\n' and sql_masked[pos:pos+3].strip().upper() == 'GO'):
                if depth == 0:
                    statement_ended = True
                    break

            if depth == 0 and (ch.isalpha() or ch == '_'):
                w_start = pos
                while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '@', '#', '$')):
                    pos += 1
                word = sql_masked[w_start:pos].lower()

                if word == 'from':
                    found_from = True
                    from_pos = w_start
                    break
                elif word in STATEMENT_BREAK_KEYWORDS:
                    statement_ended = True
                    break
            else:
                pos += 1

        if not found_from or statement_ended:
            i = m_sel.end()
            continue

        proj_str = sql_raw[sel_start + 6 : from_pos].strip()

        # After FROM, read table name and optional alias
        pos = from_pos + 4
        while pos < n and sql_masked[pos].isspace():
            pos += 1

        raw_alias = None
        if pos < n and sql_masked[pos] == '(':
            # Derived table subquery: FROM (SELECT ...) [AS] alias
            sub_start = pos + 1
            depth = 1
            pos += 1
            while pos < n and depth > 0:
                if sql_masked[pos] == '(':
                    depth += 1
                elif sql_masked[pos] == ')':
                    depth -= 1
                pos += 1
            sub_end = pos - 1
            inner_sub_sql = sql_raw[sub_start:sub_end].strip()

            while pos < n and sql_masked[pos].isspace():
                pos += 1

            w_start = pos
            while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '[', ']', '"')):
                pos += 1
            next_word = sql_raw[w_start:pos].strip()

            if next_word.lower() == 'as':
                while pos < n and sql_masked[pos].isspace():
                    pos += 1
                a_start = pos
                while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '[', ']', '"')):
                    pos += 1
                raw_alias = sql_raw[a_start:pos].strip()
            elif next_word and next_word.lower() not in STATEMENT_BREAK_KEYWORDS and next_word.lower() not in {
                "where", "join", "inner", "left", "right", "full", "cross", "outer", "on",
                "group", "order", "having", "union", "limit", "offset", "with", "into", "for", "window"
            }:
                raw_alias = next_word
            else:
                pos = w_start

            raw_table_name = f"__derived__::{raw_alias or 'sub'}::{inner_sub_sql}"
        else:
            t_start = pos
            while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '@', '#', '$', '.', '[', ']', '"')):
                pos += 1
            raw_table_name = sql_raw[t_start:pos].strip()

            if not raw_table_name:
                i = m_sel.end()
                continue

            while pos < n and sql_masked[pos].isspace():
                pos += 1

            w_start = pos
            while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '[', ']', '"')):
                pos += 1
            next_word = sql_raw[w_start:pos].strip()

            if next_word.lower() == 'as':
                while pos < n and sql_masked[pos].isspace():
                    pos += 1
                a_start = pos
                while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '[', ']', '"')):
                    pos += 1
                raw_alias = sql_raw[a_start:pos].strip()
            elif next_word and next_word.lower() not in STATEMENT_BREAK_KEYWORDS and next_word.lower() not in {
                "where", "join", "inner", "left", "right", "full", "cross", "outer", "on",
                "group", "order", "having", "union", "limit", "offset", "with", "into", "for", "window"
            }:
                raw_alias = next_word
            else:
                pos = w_start

        # Read rest_of_query until next statement boundary at depth 0
        rest_start = pos
        depth = 0
        while pos < n:
            ch = sql_masked[pos]
            if ch == '(':
                depth += 1
                pos += 1
            elif ch == ')':
                if depth > 0:
                    depth -= 1
                    pos += 1
                else:
                    break
            elif ch == ';':
                if depth == 0:
                    break
                pos += 1
            elif depth == 0 and (ch.isalpha() or ch == '_'):
                w_start = pos
                while pos < n and (sql_masked[pos].isalnum() or sql_masked[pos] in ('_', '@', '#', '$')):
                    pos += 1
                w = sql_masked[w_start:pos].lower()
                if w in STATEMENT_BREAK_KEYWORDS and w not in ('where', 'join', 'on', 'group', 'order', 'having', 'with', 'into'):
                    pos = w_start
                    break
            else:
                pos += 1

        rest_of_query = sql_raw[rest_start:pos].strip()
        yield proj_str, raw_table_name, raw_alias, rest_of_query, sel_start, pos
        i = m_sel.end()


def _find_token_position_in_line(line_text: str, token: str, masked_line_text: str | None = None) -> tuple[int, int] | None:
    """
    Find 1-indexed (col, end_col) for token on line_text.
    Ignores occurrences inside single-quoted strings and comments.
    """
    clean_tok = clean_identifier(token)
    if not clean_tok:
        return None

    search_text = masked_line_text if masked_line_text is not None else line_text

    # Strip line comment
    comment_idx = search_text.find("--")
    search_limit = comment_idx if comment_idx != -1 else len(search_text)

    # Patterns to match: [token], "token", or token (not preceded by @, #, $, or word char)
    patterns = [
        re.compile(rf"\[{re.escape(clean_tok)}\]", re.IGNORECASE),
        re.compile(rf'"{re.escape(clean_tok)}"', re.IGNORECASE),
        re.compile(rf"(?<![@#$\w]){re.escape(clean_tok)}\b", re.IGNORECASE),
    ]

    for pat in patterns:
        for m in pat.finditer(search_text[:search_limit]):
            start_pos = m.start()
            end_pos = m.end()

            # Check if start_pos is inside single quotes in original line_text
            preceding = line_text[:start_pos]
            quote_count = preceding.count("'")
            if quote_count % 2 == 1:
                continue

            return start_pos + 1, end_pos + 1

    return None


def analyze_sql_semantics(
    sql: str,
    dialect: str = "sqlserver",
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
    cached_tables_dict: dict[str, list[str]] | None = None,
    mutators: dict[str, dict] | None = None,
) -> list[dict[str, Any]]:
    """
    Main Semantic Analyzer:
    Detects invalid columns in:
    1. Table variables (@tbl)
    2. Temporary tables (#temp, CREATE TEMP TABLE, SELECT INTO)
    3. CTEs (WITH cte AS (...))
    4. Physical tables (b20customer, etc.)
    """
    if not sql or not sql.strip():
        return []

    from app.database.syntax.proc_body_detector import get_proc_local_identifiers

    sql_masked = mask_sql_literals_and_comments(sql)
    diagnostics: list[dict[str, Any]] = []
    lines = sql.splitlines()
    masked_lines = sql_masked.splitlines()

    # Collect procedure parameters and local variables to whitelist
    proc_identifiers = get_proc_local_identifiers(sql, dialect)

    if mutators is None:
        try:
            from app.services.settings_store import load_settings
            st = load_settings()
            if isinstance(st, dict):
                mutators = st.get("intellisense", {}).get("tempTableMutators")
        except Exception:
            mutators = None

    # 1. Extract local table schemas declared within the script (using masked sql to avoid literals)
    table_vars = extract_table_variables(sql_masked)
    temp_tables = extract_temporary_tables(sql_masked)
    ctes = extract_ctes(sql_masked)
    timeline = TempTableTimeline(
        sql=sql,
        sql_masked=sql_masked,
        dialect=dialect,
        cached_tables_dict=cached_tables_dict,
        mutators=mutators,
        declared_temp_tables=temp_tables,
    )

    # Combined local table schema registry: table_name_lower -> set of lowercase columns
    local_tables: dict[str, set[str]] = {}
    local_tables.update(table_vars)
    local_tables.update(temp_tables)
    local_tables.update(ctes)

    # Scopes registry to allow correlated subqueries to reference outer query aliases
    outer_table_scopes: dict[str, set[str]] = {}

    # 2. Extract SELECT / UPDATE / INSERT query statements without boundary bleed
    norm_dialect = "postgres" if ("postgres" in dialect.lower() or "pgsql" in dialect.lower() or dialect.lower() == "pg") else "sqlserver"

    for proj_str, raw_table_name, raw_alias, rest_of_query, sel_start, sel_end in extract_select_query_blocks(sql_masked, sql):
        non_alias_keywords = {
            "where", "join", "inner", "left", "right", "full", "cross", "outer", "on",
            "group", "order", "having", "union", "limit", "offset", "with", "into", "for", "window"
        }
        if raw_alias and raw_alias.lower() in non_alias_keywords:
            rest_of_query = raw_alias + (" " + rest_of_query if rest_of_query else "")
            raw_alias = None

        # 1. Detect and strip INTO clause from projection
        # E.g.: SELECT isactive INTO #temp FROM B00Layout
        into_match = re.search(
            r"\bINTO\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+)?([#@\w\.\"\[\]]+)",
            proj_str,
            re.IGNORECASE,
        )
        into_target_clean = None
        if into_match:
            into_target_raw = into_match.group(1)
            into_target_clean = clean_identifier(into_target_raw).lower()
            # Strip the INTO clause so the target table is never treated as a column of FROM table!
            proj_str = proj_str[:into_match.start()] + " " + proj_str[into_match.end():]
            # If in PostgreSQL procedural context and target is a variable, do NOT treat as temp table
            if norm_dialect == "postgres" and into_target_clean in proc_identifiers:
                into_target_clean = None

        # 2. Parse multi-part table name (supports 1, 2, 3, or 4-part names for linked servers)
        # Check if table is a derived table subquery: FROM (SELECT ...) [AS] alias
        known_columns: set[str] | None = None
        table_category = "table"

        if raw_table_name.startswith("__derived__::"):
            _, d_alias, d_inner = raw_table_name.split("::", 2)
            clean_tbl = d_alias.lower()
            alias_name = clean_identifier(raw_alias).lower() if raw_alias else clean_tbl
            known_columns = _extract_derived_columns(d_inner, local_tables, cached_tables_dict)
            table_category = "derived table"
            local_tables[clean_tbl] = known_columns
            local_tables[alias_name] = known_columns
            raw_table_name = alias_name
        else:
            t_server, t_db, t_schema, t_tbl = split_qualified_table_name(raw_table_name)
            clean_tbl = t_tbl.lower()
            alias_name = clean_identifier(raw_alias).lower() if raw_alias else clean_tbl

            is_temp_candidate = (
                clean_tbl.startswith("#")
                or (t_schema and t_schema.lower() in ("pg_temp", "temp"))
                or timeline.has_table(clean_tbl)
            )

            if clean_tbl in table_vars or (t_schema and f"{t_schema}.{clean_tbl}" in table_vars):
                known_columns = table_vars.get(clean_tbl) or table_vars.get(f"{t_schema}.{clean_tbl}")
                table_category = "table variable"
            elif is_temp_candidate:
                table_category = "temporary table"
                tbl_state = timeline.get_table_state(clean_tbl, sel_start)
                if (not tbl_state.is_defined and tbl_state.created_at_pos > sel_start) or tbl_state.is_dropped:
                    query_start_line = sql[:sel_start].count("\n") + 1
                    if norm_dialect == "postgres":
                        msg = f'relation "{clean_identifier(raw_table_name)}" does not exist'
                    else:
                        msg = f"Invalid object name '{clean_identifier(raw_table_name)}'."
                    diagnostics.append(
                        {
                            "severity": "error",
                            "message": msg,
                            "code": "SQL_INVALID_OBJECT",
                            "line": query_start_line,
                            "column": 1,
                            "end_column": 1 + len(raw_table_name),
                            "token": clean_identifier(raw_table_name),
                            "source": dialect,
                        }
                    )
                    continue

                if tbl_state.is_open:
                    known_columns = set(tbl_state.columns) | {"*"}
                elif tbl_state.is_defined and not tbl_state.is_dropped:
                    known_columns = set(tbl_state.columns)
                    # T6: Merge real columns from active DB session if available
                    if clean_tbl.startswith("#") or (t_schema and t_schema.lower() in ("pg_temp", "temp")):
                        db_cols = get_temp_table_columns_from_db(
                            connection_session=connection_session,
                            dialect=dialect,
                            table_name=clean_tbl,
                        )
                        if db_cols:
                            known_columns.update(db_cols)
                elif clean_tbl.startswith("#") or (t_schema and t_schema.lower() in ("pg_temp", "temp")):
                    known_columns = get_temp_table_columns_from_db(
                        connection_session=connection_session,
                        dialect=dialect,
                        table_name=clean_tbl,
                    )
                if known_columns:
                    temp_tables[clean_tbl] = known_columns
                    local_tables[clean_tbl] = known_columns
            elif clean_tbl in ctes:
                known_columns = ctes[clean_tbl]
                table_category = "CTE"
            else:
                # Physical table: local, database-qualified, or linked server table
                known_columns = get_physical_table_columns(
                    connection_session=connection_session,
                    dialect=dialect,
                    database=t_db or database,
                    schema=t_schema or schema,
                    table_name=clean_tbl,
                    cached_tables_dict=cached_tables_dict,
                    server=t_server,
                )
                table_category = "linked server table" if t_server else "table"

        if known_columns:
            outer_table_scopes[alias_name] = known_columns
            outer_table_scopes[clean_tbl] = known_columns

        # 3. If SELECT INTO created a target table, register its projected columns into temp_tables
        if into_target_clean:
            into_cols: set[str] = set()
            d_cnt = 0
            c_buf: list[str] = []
            for ch in proj_str:
                if ch == "(":
                    d_cnt += 1
                    c_buf.append(ch)
                elif ch == ")":
                    d_cnt = max(0, d_cnt - 1)
                    c_buf.append(ch)
                elif ch == "," and d_cnt == 0:
                    it = "".join(c_buf).strip()
                    if it:
                        into_cols.add(_extract_projection_column_name(it))
                    c_buf = []
                else:
                    c_buf.append(ch)
            last_it = "".join(c_buf).strip()
            if last_it:
                into_cols.add(_extract_projection_column_name(last_it))
            if "*" in into_cols and known_columns:
                into_cols.remove("*")
                into_cols.update(known_columns)
            clean_into = {c for c in into_cols if c}
            if clean_into:
                if into_target_clean in temp_tables:
                    temp_tables[into_target_clean].update(clean_into)
                else:
                    temp_tables[into_target_clean] = set(clean_into)
                if into_target_clean in local_tables:
                    local_tables[into_target_clean].update(clean_into)
                else:
                    local_tables[into_target_clean] = set(clean_into)

        # If table columns are unknown (e.g. offline and table metadata not cached),
        # DO NOT report errors to avoid false positives.
        if not known_columns:
            continue

        # Extract column references to check:
        # A. Columns in projection list
        referenced_tokens: list[tuple[str, str]] = []  # (token_name, qualifier)

        # Split projection expressions
        depth = 0
        curr: list[str] = []
        for ch in proj_str:
            if ch == "(":
                depth += 1
                curr.append(ch)
            elif ch == ")":
                depth = max(0, depth - 1)
                curr.append(ch)
            elif ch == "," and depth == 0:
                item = "".join(curr).strip()
                if item:
                    _extract_referenced_identifiers(item, alias_name, clean_tbl, referenced_tokens)
                curr = []
            else:
                curr.append(ch)
        last = "".join(curr).strip()
        if last:
            _extract_referenced_identifiers(last, alias_name, clean_tbl, referenced_tokens)

        # B. Columns in WHERE / ORDER BY / GROUP BY / HAVING / ON
        # Strip JOIN table declarations and nested subqueries so inner queries are not treated as outer columns
        if rest_of_query.strip():
            rest_no_sub = strip_subqueries(rest_of_query)
            rest_no_hints = re.sub(r"\bWITH\s*\([^)]*\)", " ", rest_no_sub, flags=re.IGNORECASE)
            rest_no_hints = re.sub(r"\b(?:CROSS|OUTER)\s+APPLY\b", " ", rest_no_hints, flags=re.IGNORECASE)
            rest_no_hints = re.sub(r"\)\s*(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*", ") ", rest_no_hints, flags=re.IGNORECASE)
            rest_for_cols = re.sub(
                r"\b(?:INNER\s+|LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN\s+[#@\w\.\"\[\]]+(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?",
                " ",
                rest_no_hints,
                flags=re.IGNORECASE,
            )
            _extract_referenced_identifiers(rest_for_cols, alias_name, clean_tbl, referenced_tokens, is_projection=False)

        # Collect any joined tables to avoid false positives for unqualified columns
        join_tables_known: dict[str, set[str]] = {}
        unknown_table_aliases: set[str] = set()
        has_unknown_joined_table = False

        if rest_of_query.strip():
            # Match derived tables or APPLY aliases: ) AS alias or ) alias
            derived_alias_pattern = re.compile(
                r"\)\s*(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)",
                re.IGNORECASE,
            )
            for dom in derived_alias_pattern.finditer(rest_of_query):
                d_alias = clean_identifier(dom.group(1)).lower()
                unknown_table_aliases.add(d_alias)
                has_unknown_joined_table = True

            join_pattern = re.compile(
                r"\b(?:INNER\s+|LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN\s+([#@\w\.\"\[\]]+)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?",
                re.IGNORECASE,
            )
            for jm in join_pattern.finditer(rest_of_query):
                j_raw_tbl = jm.group(1)
                j_alias = jm.group(2)
                if j_alias and j_alias.lower() in non_alias_keywords:
                    j_alias = None
                js_srv, js_db, js_sch, js_tbl = split_qualified_table_name(j_raw_tbl)
                j_clean_tbl = js_tbl.lower()
                j_alias_name = clean_identifier(j_alias).lower() if j_alias else j_clean_tbl

                is_j_temp = (
                    j_clean_tbl.startswith("#")
                    or (js_sch and js_sch.lower() in ("pg_temp", "temp"))
                    or timeline.has_table(j_clean_tbl)
                )

                j_cols = None
                if j_clean_tbl in table_vars:
                    j_cols = table_vars[j_clean_tbl]
                elif is_j_temp:
                    j_state = timeline.get_table_state(j_clean_tbl, sel_start)
                    if j_state.is_open:
                        j_cols = set(j_state.columns) | {"*"}
                    elif j_state.is_defined and not j_state.is_dropped:
                        j_cols = set(j_state.columns)
                        # T6: Merge real columns from active DB session if available
                        if j_clean_tbl.startswith("#") or (js_sch and js_sch.lower() in ("pg_temp", "temp")):
                            db_cols = get_temp_table_columns_from_db(
                                connection_session=connection_session,
                                dialect=dialect,
                                table_name=j_clean_tbl,
                            )
                            if db_cols:
                                j_cols.update(db_cols)
                    elif j_clean_tbl.startswith("#") or (js_sch and js_sch.lower() in ("pg_temp", "temp")):
                        j_cols = get_temp_table_columns_from_db(
                            connection_session=connection_session,
                            dialect=dialect,
                            table_name=j_clean_tbl,
                        )
                    if j_cols:
                        temp_tables[j_clean_tbl] = j_cols
                        local_tables[j_clean_tbl] = j_cols
                elif j_clean_tbl in ctes:
                    j_cols = ctes[j_clean_tbl]
                else:
                    j_cols = get_physical_table_columns(
                        connection_session=connection_session,
                        dialect=dialect,
                        database=js_db or database,
                        schema=js_sch or schema,
                        table_name=j_clean_tbl,
                        cached_tables_dict=cached_tables_dict,
                        server=js_srv,
                    )

                if j_cols:
                    join_tables_known[j_alias_name] = j_cols
                    join_tables_known[j_clean_tbl] = j_cols
                else:
                    # Joined table schema is unknown (e.g. created in another procedure or offline)
                    unknown_table_aliases.add(j_alias_name)
                    unknown_table_aliases.add(j_clean_tbl)
                    has_unknown_joined_table = True

        # 3. Check each referenced column against known_columns
        query_start_pos = sel_start
        query_start_line = sql[:query_start_pos].count("\n") + 1
        query_end_pos = sel_end
        query_end_line = sql[:query_end_pos].count("\n") + 1

        seen_diags: set[tuple[int, int, str]] = set()

        for token, qualifier in referenced_tokens:
            token_clean = clean_identifier(token).lower()

            # Ignore wildcard, reserved keywords, numeric literals, and table aliases themselves
            if (
                token_clean == "*"
                or token_clean in _SQL_RESERVED_IDENTIFIERS
                or token_clean == alias_name
                or token_clean == clean_tbl
                or token_clean in proc_identifiers
                or token.lower() in proc_identifiers
                or token_clean.lstrip("@") in proc_identifiers
            ):
                continue

            # Check if column is invalid
            is_invalid = False
            target_table_label = clean_identifier(raw_table_name)
            target_cat = table_category

            is_invalid_alias = False
            if qualifier:
                if qualifier in (alias_name, clean_tbl):
                    if "*" not in known_columns and token_clean not in known_columns:
                        is_invalid = True
                elif qualifier in join_tables_known:
                    j_cols = join_tables_known[qualifier]
                    if "*" not in j_cols and token_clean not in j_cols:
                        is_invalid = True
                        target_table_label = qualifier
                        target_cat = "table"
                elif qualifier in unknown_table_aliases:
                    # Qualified with a joined table whose columns are unknown; do not report false error
                    continue
                else:
                    if qualifier in local_tables:
                        l_cols = local_tables[qualifier]
                        if "*" not in l_cols and token_clean not in l_cols:
                            is_invalid = True
                            target_table_label = qualifier
                            target_cat = "table"
                    elif qualifier in outer_table_scopes:
                        o_cols = outer_table_scopes[qualifier]
                        if "*" not in o_cols and token_clean not in o_cols:
                            is_invalid = True
                            target_table_label = qualifier
                            target_cat = "table"
                    elif qualifier in ("inserted", "deleted", "dbo", "public", (schema or "").lower(), (t_schema or "").lower()):
                        continue
                    elif qualifier in _SQL_RESERVED_IDENTIFIERS or qualifier in proc_identifiers:
                        continue
                    else:
                        # Non-existent alias (Issue S5 / SEM-FN-3)
                        is_invalid_alias = True
                        target_table_label = qualifier
            else:
                if has_unknown_joined_table:
                    # Unqualified column could belong to an unknown joined table; do not report false error
                    continue
                all_known = set(known_columns)
                for j_set in join_tables_known.values():
                    all_known.update(j_set)
                if "*" not in all_known and token_clean not in all_known:
                    is_invalid = True

            if is_invalid or is_invalid_alias:
                # Find line and column in target script
                found_line = None
                found_col = 1
                search_token = qualifier if is_invalid_alias else token
                found_end_col = 1 + len(search_token)

                for l_idx in range(query_start_line - 1, min(len(lines), query_end_line)):
                    line_txt = lines[l_idx]
                    m_txt = masked_lines[l_idx] if l_idx < len(masked_lines) else None
                    pos = None
                    if qualifier and not is_invalid_alias:
                        pos = _find_token_position_in_line(line_txt, f"{qualifier}.{token}", m_txt)
                        if pos:
                            q_len = len(qualifier) + 1
                            pos = (pos[0] + q_len, pos[1])
                    if not pos:
                        pos = _find_token_position_in_line(line_txt, search_token, m_txt)
                    if pos:
                        candidate_key = (l_idx + 1, pos[0], search_token.lower())
                        if candidate_key not in seen_diags:
                            found_line = l_idx + 1
                            found_col, found_end_col = pos
                            break

                if found_line is None:
                    # Token not actually found in non-comment code lines; skip to avoid placing error on SELECT/WITH
                    continue

                key = (found_line, found_col, search_token.lower())
                if key not in seen_diags:
                    seen_diags.add(key)

                    if is_invalid_alias:
                        if norm_dialect == "postgres":
                            msg = f'missing FROM-clause entry for table "{clean_identifier(qualifier)}"'
                        else:
                            msg = f'The multi-part identifier "{clean_identifier(qualifier)}.{clean_identifier(token)}" could not be bound.'
                        code = "SQL_INVALID_ALIAS"
                        diag_token = clean_identifier(qualifier)
                    else:
                        if norm_dialect == "postgres":
                            msg = f'column "{clean_identifier(token)}" does not exist in {target_cat} "{target_table_label}"'
                        else:
                            msg = f"Invalid column name '{clean_identifier(token)}' in {target_cat} '{target_table_label}'."
                        code = "SQL_INVALID_COLUMN"
                        diag_token = clean_identifier(token)

                    diagnostics.append(
                        {
                            "severity": "error",
                            "message": msg,
                            "code": code,
                            "line": found_line,
                            "column": found_col,
                            "end_column": found_end_col,
                            "token": diag_token,
                            "source": dialect,
                        }
                    )

    # 4. Check column references in INSERT INTO target_table (col1, col2, ...)
    insert_pattern = re.compile(
        r"\bINSERT\s+INTO\s+([#@\w\.\"\[\]]+)\s*\((.*?)\)",
        re.IGNORECASE | re.DOTALL,
    )
    for im in insert_pattern.finditer(sql_masked):
        i_raw_tbl = sql[im.start(1):im.end(1)]
        i_col_str = sql[im.start(2):im.end(2)]
        _, _, _, i_tbl = split_qualified_table_name(i_raw_tbl)
        i_clean_tbl = i_tbl.lower()

        i_is_temp = i_clean_tbl.startswith("#") or timeline.has_table(i_clean_tbl)
        i_known_cols = None
        i_cat = "table"
        if i_clean_tbl in table_vars:
            i_known_cols = table_vars[i_clean_tbl]
            i_cat = "table variable"
        elif i_is_temp:
            i_cat = "temporary table"
            i_state = timeline.get_table_state(i_clean_tbl, im.start())
            if i_state.is_open:
                i_known_cols = set(i_state.columns) | {"*"}
            elif i_state.is_defined and not i_state.is_dropped:
                i_known_cols = set(i_state.columns)
            elif i_clean_tbl.startswith("#"):
                i_known_cols = get_temp_table_columns_from_db(connection_session, dialect, i_clean_tbl)
        else:
            i_server, i_db, i_schema, i_tbl_name = split_qualified_table_name(i_raw_tbl)
            i_known_cols = get_physical_table_columns(
                connection_session=connection_session,
                dialect=dialect,
                database=i_db or database,
                schema=i_schema or schema,
                table_name=i_tbl_name.lower(),
                cached_tables_dict=cached_tables_dict,
                server=i_server,
            )
            i_cat = "linked server table" if i_server else "table"

        if i_known_cols and "*" not in i_known_cols:
            i_start_line = sql[: im.start()].count("\n") + 1
            i_end_line = sql[: im.end()].count("\n") + 1
            for col_item in i_col_str.split(","):
                col_item_clean = col_item.strip()
                if col_item_clean.startswith("@"):
                    continue
                c_clean = clean_identifier(col_item_clean).lower()
                if not c_clean or c_clean in _SQL_RESERVED_IDENTIFIERS:
                    continue
                if c_clean not in i_known_cols:
                    for l_idx in range(i_start_line - 1, min(len(lines), i_end_line)):
                        line_txt = lines[l_idx]
                        m_txt = masked_lines[l_idx] if l_idx < len(masked_lines) else None
                        pos = _find_token_position_in_line(line_txt, col_item.strip(), m_txt)
                        if pos:
                            f_line = l_idx + 1
                            f_col, f_end_col = pos
                            if norm_dialect == "postgres":
                                msg = f'column "{clean_identifier(col_item)}" does not exist in {i_cat} "{clean_identifier(i_raw_tbl)}"'
                            else:
                                msg = f"Invalid column name '{clean_identifier(col_item)}' in {i_cat} '{clean_identifier(i_raw_tbl)}'."
                            diagnostics.append(
                                {
                                    "severity": "error",
                                    "message": msg,
                                    "code": "SQL_INVALID_COLUMN",
                                    "line": f_line,
                                    "column": f_col,
                                    "end_column": f_end_col,
                                    "token": clean_identifier(col_item),
                                    "source": dialect,
                                }
                            )
                            break

    # 5. Check column references in UPDATE target_table SET col1 = val1, ...
    update_break_keywords = r"\b(?:WHERE|FROM|DECLARE|SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|SET|IF|WHILE|BEGIN|END|RETURN|PRINT|GO)\b|;|(?:\r?\n\s*\r?\n)|$"
    update_pattern = re.compile(
        rf"\bUPDATE\s+([#@\w\.\"\[\]]+)\s+SET\s+(.*?)(?={update_break_keywords})",
        re.IGNORECASE | re.DOTALL,
    )
    for um in update_pattern.finditer(sql_masked):
        u_raw_tbl = sql[um.start(1):um.end(1)]
        u_set_str = sql[um.start(2):um.end(2)]
        _, _, _, u_tbl = split_qualified_table_name(u_raw_tbl)
        u_clean_tbl = u_tbl.lower()

        u_is_temp = u_clean_tbl.startswith("#") or timeline.has_table(u_clean_tbl)
        u_known_cols = None
        u_cat = "table"
        if u_clean_tbl in table_vars:
            u_known_cols = table_vars[u_clean_tbl]
            u_cat = "table variable"
        elif u_is_temp:
            u_cat = "temporary table"
            u_state = timeline.get_table_state(u_clean_tbl, um.start())
            if u_state.is_open:
                u_known_cols = set(u_state.columns) | {"*"}
            elif u_state.is_defined and not u_state.is_dropped:
                u_known_cols = set(u_state.columns)
            elif u_clean_tbl.startswith("#"):
                u_known_cols = get_temp_table_columns_from_db(connection_session, dialect, u_clean_tbl)
        else:
            u_server, u_db, u_schema, u_tbl_name = split_qualified_table_name(u_raw_tbl)
            u_known_cols = get_physical_table_columns(
                connection_session=connection_session,
                dialect=dialect,
                database=u_db or database,
                schema=u_schema or schema,
                table_name=u_tbl_name.lower(),
                cached_tables_dict=cached_tables_dict,
                server=u_server,
            )
            u_cat = "linked server table" if u_server else "table"

        if u_known_cols and "*" not in u_known_cols:
            u_start_line = sql[: um.start()].count("\n") + 1
            u_end_line = sql[: um.end()].count("\n") + 1
            assignments = re.findall(r"(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*=", u_set_str)
            for a in assignments:
                target_col = (a[0] or a[1] or a[2]).strip()
                if target_col.startswith("@"):
                    continue  # T-SQL variable assignment, not a table column!
                c_clean = clean_identifier(target_col).lower()
                if not c_clean or c_clean in _SQL_RESERVED_IDENTIFIERS:
                    continue
                if c_clean not in u_known_cols:
                    for l_idx in range(u_start_line - 1, min(len(lines), u_end_line)):
                        line_txt = lines[l_idx]
                        m_txt = masked_lines[l_idx] if l_idx < len(masked_lines) else None
                        pos = _find_token_position_in_line(line_txt, target_col, m_txt)
                        if pos:
                            f_line = l_idx + 1
                            f_col, f_end_col = pos
                            if norm_dialect == "postgres":
                                msg = f'column "{clean_identifier(target_col)}" does not exist in {u_cat} "{clean_identifier(u_raw_tbl)}"'
                            else:
                                msg = f"Invalid column name '{clean_identifier(target_col)}' in {u_cat} '{clean_identifier(u_raw_tbl)}'."
                            diagnostics.append(
                                {
                                    "severity": "error",
                                    "message": msg,
                                    "code": "SQL_INVALID_COLUMN",
                                    "line": f_line,
                                    "column": f_col,
                                    "end_column": f_end_col,
                                    "token": clean_identifier(target_col),
                                    "source": dialect,
                                }
                            )
                            break

    return diagnostics


def _extract_referenced_identifiers(
    expr_text: str,
    table_alias: str,
    table_name: str,
    out_list: list[tuple[str, str]],
    is_projection: bool = True,
) -> None:
    """
    Extract referenced column identifiers from an expression string,
    distinguishing input columns from output AS aliases.
    """
    # 0. Strip subqueries so their inner columns are not treated as outer columns
    cleaned = strip_subqueries(expr_text)

    # 1. Strip comments (both multi-line /* */ and single-line -- with MULTILINE flag)
    cleaned = re.sub(r"/\*.*?\*/", " ", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"--.*$", " ", cleaned, flags=re.MULTILINE)

    # 2. Remove string literals (including N'...' Unicode literals) to avoid false positives
    cleaned = re.sub(r"(?:\bN)?'[^']*'", "''", cleaned, flags=re.IGNORECASE)

    # 3. Remove output AS aliases: expr AS my_alias -> ignore my_alias
    cleaned = re.sub(r"\bAS\s+(?:\[[^\]]+\]|\"[^\"]+\"|[a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\b", " ", cleaned, flags=re.IGNORECASE)
    # Remove T-SQL alias assignment: my_alias = expr
    cleaned = re.sub(r"^\s*(?:\[[^\]]+\]|\"[^\"]+\"|[a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\s*=\s*", " ", cleaned)
    if is_projection:
        # Also remove any @var = expr variable assignment within projection
        cleaned = re.sub(r"@[a-zA-Z0-9_]+\s*=\s*", " ", cleaned)
        # Remove trailing space-separated alias: expr my_alias
        cleaned = re.sub(r"\s+(?:\[[^\]]+\]|\"[^\"]+\"|[a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\s*$", " ", cleaned)

    # 4. Match any qualified column reference: alias.col or table.col
    qual_pattern = re.compile(
        r"(?:\[([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\]|\"([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\"|\b([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\b)\.(?:\[([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\]|\"([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\"|\b([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\b)",
        re.IGNORECASE,
    )
    for qm in qual_pattern.finditer(cleaned):
        q_tbl = qm.group(1) or qm.group(2) or qm.group(3)
        q_col = qm.group(4) or qm.group(5) or qm.group(6)
        if q_tbl and q_col:
            q_col_clean = clean_identifier(q_col).lower()
            if q_col_clean != "*" and q_col_clean not in _SQL_RESERVED_IDENTIFIERS:
                out_list.append((q_col, clean_identifier(q_tbl).lower()))

    # 5. Match unqualified identifiers: [col], "col", or col (ensuring not prefixed with @, #, $, or .)
    unqual_pattern = re.compile(
        r"(?:\[([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\]|\"([a-zA-Z_@#$][a-zA-Z0-9_@#$]*)\"|(?<![@#$\w])([a-zA-Z_][a-zA-Z0-9_]*)\b)",
        re.IGNORECASE,
    )
    for um in unqual_pattern.finditer(cleaned):
        col = um.group(1) or um.group(2) or um.group(3)
        if not col:
            continue
        # Skip variables (@var, @@var), temp tables (#temp), positional params ($1)
        if col.startswith(("@", "#", "$")):
            continue
        start_idx = um.start()
        if start_idx > 0 and cleaned[start_idx - 1] in (".", "@", "#", "$"):
            continue
        end_idx = um.end()
        rest = cleaned[end_idx:].lstrip()
        # If followed by '.' (table prefix) or '(' (function call like CAST, COALESCE, etc.)
        if rest.startswith(".") or rest.startswith("("):
            continue
        col_clean = clean_identifier(col).lower()
        if col_clean in _SQL_RESERVED_IDENTIFIERS or col_clean.isdigit():
            continue
        out_list.append((col, ""))

