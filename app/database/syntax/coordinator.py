# -*- coding: utf-8 -*-
"""
Syntax Check Coordinator.
Orchestrates the modern syntax checking pipeline:
1. Dialect Resolver -> selects Adapter (ScriptDOM for T-SQL, Hybrid for PostgreSQL).
2. Adapter Parse -> parses grammar and syntax errors without database side-effects.
3. Custom Rules Layer -> executes Semantic Analyzer (app.database.syntax.semantic_analyzer).
4. Diagnostics Deduplication -> removes duplicate markers.
5. Graceful Fallback & Instant Rollback Toggle.

Complies with Section 6 & 7 of .SKILL/SQL_Syntax_Check_Parser_Extension.md.
"""
from __future__ import annotations

import logging
from typing import Any

from app.database.syntax.adapters import (
    deduplicate_diagnostics,
    get_syntax_adapter,
    normalize_diagnostic,
)

logger = logging.getLogger(__name__)

# Rollback switch: If set to True, bypasses adapter pipeline and uses legacy validate_sql
USE_LEGACY_SYNTAX_VALIDATOR: bool = False


def validate_sql_pipeline(
    sql: str,
    dialect: str = "sqlserver",
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
    is_debug: bool = False,
    cached_tables_dict: dict[str, list[str]] | None = None,
    force_legacy: bool = False,
) -> list[dict[str, Any]]:
    """
    Main pipeline entrypoint for syntax and semantic validation across SQL Server and PostgreSQL.
    Combines high-performance static parser extensions with semantic column validation.
    """
    if not sql or not sql.strip():
        return []

    # Rollback mode if requested
    if USE_LEGACY_SYNTAX_VALIDATOR or force_legacy:
        from app.database.syntax.validator import validate_sql as legacy_validate_sql

        return legacy_validate_sql(
            sql=sql,
            dialect=dialect,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
            cached_tables_dict=cached_tables_dict,
        )

    # 1. Grammar / Syntax Parsing via Dialect Adapter
    adapter = get_syntax_adapter(dialect)
    try:
        diagnostics = adapter.validate(
            sql=sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
        )
    except Exception as exc:
        logger.warning(
            f"[SyntaxCoordinator] Adapter error, falling back to legacy validator: {exc}"
        )
        from app.database.syntax.validator import validate_sql as legacy_validate_sql

        return legacy_validate_sql(
            sql=sql,
            dialect=dialect,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
            cached_tables_dict=cached_tables_dict,
        )

    # 2. Custom Semantic Validation Layer (Physical tables, temp tables, table variables, CTEs)
    try:
        from app.database.syntax.semantic_analyzer import analyze_sql_semantics

        d_lower = (dialect or "sqlserver").strip().lower()
        semantic_diags = analyze_sql_semantics(
            sql=sql,
            dialect=d_lower,
            connection_session=connection_session,
            database=database,
            schema=schema,
            cached_tables_dict=cached_tables_dict,
        )
        if semantic_diags:
            normalized_semantics = [
                normalize_diagnostic(d, default_source=d_lower, sql=sql)
                for d in semantic_diags
            ]
            diagnostics.extend(normalized_semantics)
    except Exception as sem_exc:
        logger.debug(f"[SyntaxCoordinator] Semantic analyzer exception: {sem_exc}")

    # 3. Deduplication (line, column, token)
    return deduplicate_diagnostics(diagnostics)
