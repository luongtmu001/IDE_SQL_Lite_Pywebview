# -*- coding: utf-8 -*-
"""
SQL Syntax Adapters Package.
Provides dialect-specific syntax adapters for SQL Server (ScriptDOM) and PostgreSQL.
"""
from __future__ import annotations

from app.database.syntax.adapters.base import BaseSyntaxAdapter
from app.database.syntax.adapters.diagnostics_mapper import (
    clean_diagnostic_message,
    deduplicate_diagnostics,
    normalize_diagnostic,
)
from app.database.syntax.adapters.postgresql_adapter import PostgreSqlAdapter
from app.database.syntax.adapters.sqlserver_scriptdom import SqlServerScriptDomAdapter

_SQLSERVER_ADAPTER = None
_POSTGRES_ADAPTER = None


def get_syntax_adapter(dialect: str = "sqlserver") -> BaseSyntaxAdapter:
    """Factory function returning the singleton adapter instance for a dialect."""
    global _SQLSERVER_ADAPTER, _POSTGRES_ADAPTER

    d = (dialect or "sqlserver").lower().strip()
    if "postgres" in d or "pgsql" in d or d == "pg":
        if _POSTGRES_ADAPTER is None:
            _POSTGRES_ADAPTER = PostgreSqlAdapter()
        return _POSTGRES_ADAPTER

    if _SQLSERVER_ADAPTER is None:
        _SQLSERVER_ADAPTER = SqlServerScriptDomAdapter()
    return _SQLSERVER_ADAPTER


__all__ = [
    "BaseSyntaxAdapter",
    "SqlServerScriptDomAdapter",
    "PostgreSqlAdapter",
    "get_syntax_adapter",
    "normalize_diagnostic",
    "deduplicate_diagnostics",
    "clean_diagnostic_message",
]
