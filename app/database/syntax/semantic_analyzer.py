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

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Global in-memory cache for physical table columns
# Key: (dialect, server_lower, database_lower, schema_lower, table_lower) -> set of lowercase column names
_PHYSICAL_TABLE_COLUMNS_CACHE: dict[tuple[str, str, str, str, str], set[str]] = {}

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


def extract_temporary_tables(sql: str) -> dict[str, set[str]]:
    """
    Extract temporary tables:
    1. CREATE TABLE #temp ( col1 INT, col2 VARCHAR(50) )
    2. CREATE TEMP TABLE temp_name ( col1 INT, col2 TEXT )
    3. SELECT col1, col2, expr AS col3 INTO #temp FROM ...
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
        is_temp = clean_name.startswith("#") or "TEMP" in m.group(0).upper() or clean_name.startswith("temp_")
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
                    elif word in ("union", "begin", "end", "go", "insert", "update", "delete"):
                        break
                    continue
            pos -= 1

        if sel_pos != -1:
            proj_str = sql[sel_pos + 6 : m.start()].strip()
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
                        cols.add(_extract_projection_column_name(item))
                    curr = []
                else:
                    curr.append(ch)
            last = "".join(curr).strip()
            if last:
                if "*" in last:
                    has_wildcard = True
                cols.add(_extract_projection_column_name(last))

            if has_wildcard:
                cols.add("*")

            clean_cols = {c for c in cols if c}
            if clean_cols:
                if clean_name in temp_tables:
                    temp_tables[clean_name].update(clean_cols)
                else:
                    temp_tables[clean_name] = clean_cols

    # 3. INSERT INTO #temp (col1, col2, ...)
    insert_pattern = re.compile(
        r"\bINSERT\s+INTO\s+([#@\w\.\"\[\]]+)\s*\((.*?)\)",
        re.IGNORECASE | re.DOTALL,
    )
    for im in insert_pattern.finditer(sql):
        raw_name = im.group(1)
        clean_name = clean_identifier(raw_name).lower()
        if clean_name.startswith("#") or clean_name.startswith("temp_"):
            cols_str = im.group(2)
            c_items = [clean_identifier(c).lower() for c in cols_str.split(",") if c.strip()]
            if c_items:
                if clean_name in temp_tables:
                    temp_tables[clean_name].update(c_items)
                else:
                    temp_tables[clean_name] = set(c_items)

    return temp_tables


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
                cols = set()
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
                            cols.add(_extract_projection_column_name(item))
                        curr = []
                    else:
                        curr.append(ch)
                last = "".join(curr).strip()
                if last:
                    cols.add(_extract_projection_column_name(last))
                clean_cols = {c for c in cols if c and c != "*"}
                if clean_cols:
                    ctes[cte_name] = clean_cols

    return ctes


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
    if expr == "*":
        return "*"

    # Match: expr AS alias or expr [alias] or expr "alias"
    as_match = re.search(r"\bAS\s+(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*$", expr, re.IGNORECASE)
    if as_match:
        alias = as_match.group(1) or as_match.group(2) or as_match.group(3)
        return clean_identifier(alias).lower()

    # Match: alias = expr (T-SQL alias assignment)
    t_sql_alias = re.match(r"^\s*(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*=\s*", expr)
    if t_sql_alias:
        alias = t_sql_alias.group(1) or t_sql_alias.group(2) or t_sql_alias.group(3)
        return clean_identifier(alias).lower()

    # Match simple column: tbl.col or col or [col]
    simple_col = re.match(r"^(?:(?:[#@\w\.\"\[\]]+)\.)?(?:\[([^\]]+)\]|\"([^\"]+)\"|([a-zA-Z_@#$][a-zA-Z0-9_@#$]*))\s*$", expr)
    if simple_col:
        col = simple_col.group(1) or simple_col.group(2) or simple_col.group(3)
        return clean_identifier(col).lower()

    return ""


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

    # Check cache first
    cache_key = (norm_dialect, "", "tempdb", "dbo", clean_tbl)
    if cache_key in _PHYSICAL_TABLE_COLUMNS_CACHE:
        return _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key]

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
                # 1. Query by OBJECT_ID('tempdb..#temp')
                query = """
                    SELECT c.name
                    FROM tempdb.sys.columns c
                    WHERE c.object_id = OBJECT_ID('tempdb..' + ?)
                """
                cursor.execute(query, (temp_name,))
                rows = cursor.fetchall()
                if not rows:
                    # 2. Fallback: Query tempdb.sys.tables where name matches session temp table prefix
                    query2 = """
                        SELECT c.name
                        FROM tempdb.sys.columns c
                        JOIN tempdb.sys.tables t ON t.object_id = c.object_id
                        WHERE LOWER(t.name) LIKE LOWER(?) + '[_]%'
                    """
                    cursor.execute(query2, (temp_name,))
                    rows = cursor.fetchall()
                if rows:
                    cols = {clean_identifier(r[0]).lower() for r in rows if r and r[0]}
                    _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                    return cols
            else:
                # PostgreSQL temporary tables live in pg_temp or pg_temp_%
                query = """
                    SELECT a.attname
                    FROM pg_catalog.pg_attribute a
                    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE LOWER(c.relname) = LOWER(%s)
                      AND (n.nspname = 'pg_temp' OR n.nspname LIKE 'pg_temp_%%')
                      AND a.attnum > 0 AND NOT a.attisdropped
                """
                cursor.execute(query, (clean_tbl,))
                rows = cursor.fetchall()
                if rows:
                    cols = {clean_identifier(r[0]).lower() for r in rows if r and r[0]}
                    _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
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

    # Check process in-memory cache
    cache_key = (norm_dialect, clean_server, clean_db, clean_schema, clean_tbl)
    if cache_key in _PHYSICAL_TABLE_COLUMNS_CACHE:
        return _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key]
    if not clean_schema:
        simple_key = (norm_dialect, clean_server, "", "", clean_tbl)
        if simple_key in _PHYSICAL_TABLE_COLUMNS_CACHE:
            return _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key]

    # Check connection_session.metadata_cache before attempting connection lock
    if connection_session:
        meta_cache = getattr(connection_session, "metadata_cache", None)
        if isinstance(meta_cache, dict):
            for k, v in meta_cache.items():
                if ("column" in k.lower() or "intellisense" in k.lower()) and k.lower().endswith(f"::{clean_tbl}"):
                    if isinstance(v, list) and v:
                        cols = {clean_identifier(c.get("name", str(c))).lower() for c in v if (isinstance(c, dict) and c.get("name")) or isinstance(c, str)}
                        if cols:
                            _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                            _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                            return cols

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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                        return cols
            if hasattr(meta_service, "get_intellisense_columns"):
                items = meta_service.get_intellisense_columns(clean_db or database or None, clean_schema or schema or None, clean_tbl)
                if items:
                    cols = {clean_identifier(c.get("name", "")).lower() for c in items if c and c.get("name")}
                    if cols:
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                        return cols
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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                        return cols
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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                        return cols
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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                        return cols
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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        _PHYSICAL_TABLE_COLUMNS_CACHE[simple_key] = cols
                        return cols
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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        return cols
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
                        _PHYSICAL_TABLE_COLUMNS_CACHE[cache_key] = cols
                        return cols
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

    sql_masked = mask_sql_literals_and_comments(sql)
    diagnostics: list[dict[str, Any]] = []
    lines = sql.splitlines()
    masked_lines = sql_masked.splitlines()

    # 1. Extract local table schemas declared within the script (using masked sql to avoid literals)
    table_vars = extract_table_variables(sql_masked)
    temp_tables = extract_temporary_tables(sql_masked)
    ctes = extract_ctes(sql_masked)

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

            if clean_tbl in table_vars or (t_schema and f"{t_schema}.{clean_tbl}" in table_vars):
                known_columns = table_vars.get(clean_tbl) or table_vars.get(f"{t_schema}.{clean_tbl}")
                table_category = "table variable"
            elif clean_tbl in temp_tables or (t_schema and f"{t_schema}.{clean_tbl}" in temp_tables):
                known_columns = temp_tables.get(clean_tbl) or temp_tables.get(f"{t_schema}.{clean_tbl}")
                table_category = "temporary table"
            elif clean_tbl.startswith("#") or clean_tbl.startswith("temp_") or (t_schema and t_schema.lower() in ("pg_temp", "temp")):
                # Temporary table created outside current script/procedure - query from DB session
                known_columns = get_temp_table_columns_from_db(
                    connection_session=connection_session,
                    dialect=dialect,
                    table_name=clean_tbl,
                )
                table_category = "temporary table"
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

                j_cols = None
                if j_clean_tbl in table_vars:
                    j_cols = table_vars[j_clean_tbl]
                elif j_clean_tbl in temp_tables:
                    j_cols = temp_tables[j_clean_tbl]
                elif j_clean_tbl.startswith("#") or j_clean_tbl.startswith("temp_") or (js_sch and js_sch.lower() in ("pg_temp", "temp")):
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
            if token_clean == "*" or token_clean in _SQL_RESERVED_IDENTIFIERS or token_clean == alias_name or token_clean == clean_tbl:
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
                    elif qualifier in _SQL_RESERVED_IDENTIFIERS:
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
                    pos = _find_token_position_in_line(line_txt, search_token, m_txt)
                    if pos:
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

        i_known_cols = None
        i_cat = "table"
        if i_clean_tbl in table_vars:
            i_known_cols = table_vars[i_clean_tbl]
            i_cat = "table variable"
        elif i_clean_tbl in temp_tables:
            i_known_cols = temp_tables[i_clean_tbl]
            i_cat = "temporary table"
        elif i_clean_tbl.startswith("#"):
            i_known_cols = get_temp_table_columns_from_db(connection_session, dialect, i_clean_tbl)
            i_cat = "temporary table"
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

        if i_known_cols:
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

        u_known_cols = None
        u_cat = "table"
        if u_clean_tbl in table_vars:
            u_known_cols = table_vars[u_clean_tbl]
            u_cat = "table variable"
        elif u_clean_tbl in temp_tables:
            u_known_cols = temp_tables[u_clean_tbl]
            u_cat = "temporary table"
        elif u_clean_tbl.startswith("#"):
            u_known_cols = get_temp_table_columns_from_db(connection_session, dialect, u_clean_tbl)
            u_cat = "temporary table"
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

        if u_known_cols:
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

