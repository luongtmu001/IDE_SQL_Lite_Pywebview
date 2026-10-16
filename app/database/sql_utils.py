"""
SQL utility functions for identifier quoting, qualified naming, and literal escaping.
Centralized module supporting SQL Server and PostgreSQL engines.
"""
from typing import Any, Optional


def quote_ident(name: Optional[str], engine: str = "sqlserver") -> str:
    """
    Quotes a database identifier (table, column, schema, index, etc.).
    Escapes internal closing brackets ']' by doubling them ']]' for SQL Server,
    or double quotes '"' by doubling them '""' for PostgreSQL.
    Does NOT blindly trust already-bracketed or quoted names to prevent SQL injection.
    """
    if name is None:
        return ""
    s = str(name).strip()
    if not s:
        return ""

    eng = (engine or "sqlserver").lower()

    if eng in ("postgresql", "postgres", "sqlite", "sqlite3"):
        # If wrapped in outer double-quotes, safely unwrap first
        if s.startswith('"') and s.endswith('"') and len(s) >= 2:
            inner = s[1:-1].replace('""', '"')
        else:
            inner = s
        escaped = inner.replace('"', '""')
        return f'"{escaped}"'
    else:
        # Default to SQL Server / T-SQL bracket quoting
        if s.startswith('[') and s.endswith(']') and len(s) >= 2:
            inner = s[1:-1].replace(']]', ']')
        else:
            inner = s
        escaped = inner.replace(']', ']]')
        return f'[{escaped}]'


def quote_qualified(*parts: Optional[str], engine: str = "sqlserver") -> str:
    """
    Quotes and joins multiple identifier parts (e.g., db, schema, table).
    Omits None or empty parts.
    Example: quote_qualified("dbo", "Users", engine="sqlserver") -> "[dbo].[Users]"
    """
    quoted_parts = []
    for p in parts:
        if p is not None and str(p).strip():
            quoted_parts.append(quote_ident(p, engine=engine))
    return ".".join(quoted_parts)


def escape_literal(val: Any, engine: str = "sqlserver") -> str:
    """
    Escapes a literal value for safe embedding in dynamic SQL.
    None -> NULL
    bool -> 1 / 0 (SQL Server/SQLite) or TRUE / FALSE (PostgreSQL)
    int / float -> str(val)
    str -> escaped single quotes, with optional N'...' prefix for Unicode in SQL Server.
    """
    if val is None:
        return "NULL"

    eng = (engine or "sqlserver").lower()
    if isinstance(val, bool):
        if eng in ("postgresql", "postgres"):
            return "TRUE" if val else "FALSE"
        return "1" if val else "0"

    if isinstance(val, (int, float)):
        return str(val)

    s = str(val).replace("'", "''")
    if eng in ("sqlserver", "mssql") and any(ord(c) > 127 for c in s):
        return f"N'{s}'"
    return f"'{s}'"

