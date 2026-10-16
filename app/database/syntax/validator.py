# -*- coding: utf-8 -*-
"""
Backend SQL Syntax Validator Facade for SQL Server (T-SQL) and PostgreSQL.
Orchestrates dialect-specific validators (validator_mssql and validator_pg)
and coordinates with the semantic analyzer.

Complies with Giai đoạn 6 (Phase 6) modular structure requirements.
"""
from __future__ import annotations

import logging
from typing import Any

from app.database.syntax.validator_mssql import (
    split_sqlserver_batches,
    _clean_sqlserver_message,
    _find_all_empty_select_tokens,
    _find_all_missing_join_tokens,
    _find_all_trailing_comma_tokens,
    _validate_with_sqlglot,
    validate_sql_server,
)
from app.database.syntax.validator_pg import (
    _position_to_line_col,
    mask_debug_extensions_for_validation,
    _filter_debug_diagnostics,
    _is_destructive_or_locking_ddl,
    validate_postgresql,
)

logger = logging.getLogger(__name__)

__all__ = [
    "validate_sql",
    "validate_sql_server",
    "validate_postgresql",
    "split_sqlserver_batches",
    "mask_debug_extensions_for_validation",
]


def validate_sql(
    sql: str,
    dialect: str = "sqlserver",
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
    is_debug: bool = False,
    cached_tables_dict: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """
    Main entrypoint facade for syntax and semantic validation across SQL Server and PostgreSQL.
    Combines database-native syntax checking (or fallback) with semantic column/table
    verification for physical tables, temporary tables, table variables, and CTEs.
    """
    if not sql or not sql.strip():
        return []

    d = (dialect or "sqlserver").strip().lower()

    # 1. Native Database Syntax / Grammar Validation
    if "postgres" in d or "pgsql" in d or d == "pg":
        diagnostics = validate_postgresql(
            sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
        )
    else:
        diagnostics = validate_sql_server(
            sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
        )

    # 2. Semantic Analysis: validate columns in physical tables, temp tables, table variables, and CTEs
    try:
        from app.database.syntax.semantic_analyzer import analyze_sql_semantics
        semantic_diags = analyze_sql_semantics(
            sql=sql,
            dialect=d,
            connection_session=connection_session,
            database=database,
            schema=schema,
            cached_tables_dict=cached_tables_dict,
        )
        if semantic_diags:
            # Merge and deduplicate by (line, column, token)
            existing_keys = {
                (diag.get("line"), diag.get("column"), str(diag.get("token", "")).lower())
                for diag in diagnostics
            }
            for s_diag in semantic_diags:
                key = (s_diag.get("line"), s_diag.get("column"), str(s_diag.get("token", "")).lower())
                if key not in existing_keys:
                    diagnostics.append(s_diag)
                    existing_keys.add(key)
    except Exception as exc:
        logger.debug(f"[SyntaxCheck] semantic analyzer exception: {exc}")

    return diagnostics
