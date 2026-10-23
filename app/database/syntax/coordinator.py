# -*- coding: utf-8 -*-
"""
Syntax Check Coordinator.
Orchestrates the modern syntax checking pipeline:
1. Statement-level Syntax Cache (5s TTL, invalidation on connection change/DDL).
2. Dialect Resolver -> selects Adapter (ScriptDOM for T-SQL, Hybrid for PostgreSQL).
3. Adapter Parse -> parses grammar and syntax errors without database side-effects.
4. Custom Rules Layer -> executes Semantic Analyzer (app.database.syntax.semantic_analyzer).
5. Best-Practice Rules Layer -> executes BP001-BP006 warnings (app.database.syntax.best_practice_rules).
6. Diagnostics Deduplication -> removes duplicate markers.
7. Graceful Fallback & Instant Rollback Toggle.

Complies with Section 6 & 7 of .SKILL/SQL_Syntax_Check_Parser_Extension.md.
"""
from __future__ import annotations

import copy
import hashlib
import logging
import threading
import time
from typing import Any, NamedTuple

from app.database.syntax.adapters import (
    deduplicate_diagnostics,
    get_syntax_adapter,
    normalize_diagnostic,
)
from app.database.syntax.best_practice_rules import check_best_practice_rules

logger = logging.getLogger(__name__)

# Rollback switch: If set to True, bypasses adapter pipeline and uses legacy validate_sql
USE_LEGACY_SYNTAX_VALIDATOR: bool = False

# Cache Configuration (C3)
CACHE_TTL_SECONDS: float = 5.0
CACHE_MAX_SIZE: int = 512


class _CacheEntry(NamedTuple):
    timestamp: float
    diagnostics: list[dict[str, Any]]
    connection_id: str | None


_SYNTAX_CACHE: dict[str, _CacheEntry] = {}
_CACHE_LOCK = threading.Lock()


def _compute_cache_key(
    sql: str,
    dialect: str,
    conn_id: str | None,
    database: str | None,
    schema: str | None,
    is_debug: bool,
    include_best_practice: bool = False,
) -> str:
    """Computes a unique SHA-256 cache key for a statement verification request."""
    normalized_sql = sql.strip()
    raw = f"{normalized_sql}||{dialect.lower()}||{conn_id or ''}||{database or ''}||{schema or ''}||{is_debug}||{include_best_practice}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def invalidate_syntax_cache(connection_id: str | None = None) -> int:
    """
    Clears the syntax validation cache.
    If connection_id is specified, only entries tied to that connection (or all) are purged.
    Returns the number of invalidated items.
    """
    with _CACHE_LOCK:
        if connection_id is None:
            count = len(_SYNTAX_CACHE)
            _SYNTAX_CACHE.clear()
            return count
        else:
            to_remove = [
                k for k, v in _SYNTAX_CACHE.items()
                if v.connection_id == connection_id or v.connection_id is None
            ]
            for k in to_remove:
                del _SYNTAX_CACHE[k]
            return len(to_remove)


def get_syntax_cache_size() -> int:
    """Returns current active syntax cache count."""
    with _CACHE_LOCK:
        return len(_SYNTAX_CACHE)


def validate_sql_pipeline(
    sql: str,
    dialect: str = "sqlserver",
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
    is_debug: bool = False,
    cached_tables_dict: dict[str, list[str]] | None = None,
    force_legacy: bool = False,
    bypass_cache: bool = False,
    include_best_practice: bool = False,
) -> list[dict[str, Any]]:
    """
    Main pipeline entrypoint for syntax, semantic, and best-practice validation.
    Combines high-performance static parser extensions with semantic column validation and
    statement-level caching (5s TTL).
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

    conn_id = getattr(connection_session, "id", None) or getattr(connection_session, "connection_id", None)
    d_lower = (dialect or "sqlserver").strip().lower()

    # 1. Statement-level Syntax Cache Lookup (C3)
    cache_key = _compute_cache_key(
        sql,
        d_lower,
        str(conn_id) if conn_id else None,
        database,
        schema,
        is_debug,
        include_best_practice=include_best_practice,
    )
    now = time.time()

    if not bypass_cache:
        with _CACHE_LOCK:
            entry = _SYNTAX_CACHE.get(cache_key)
            if entry and (now - entry.timestamp) <= CACHE_TTL_SECONDS:
                return copy.deepcopy(entry.diagnostics)

    # 2. Grammar / Syntax Parsing via Dialect Adapter
    adapter = get_syntax_adapter(d_lower)
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
            dialect=d_lower,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
            cached_tables_dict=cached_tables_dict,
        )

    # 3. Custom Semantic Validation Layer (B2)
    # Validates physical tables, temp tables, table variables, CTEs
    try:
        from app.database.syntax.semantic_analyzer import analyze_sql_semantics

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

    # 4. Best-Practice Warning Rules Layer (C1)
    if include_best_practice:
        try:
            bp_diags = check_best_practice_rules(sql=sql, dialect=d_lower)
            if bp_diags:
                normalized_bp = [
                    normalize_diagnostic(d, default_source="best-practice", sql=sql)
                    for d in bp_diags
                ]
                diagnostics.extend(normalized_bp)
        except Exception as bp_exc:
            logger.debug(f"[SyntaxCoordinator] Best practice rules exception: {bp_exc}")

    # 5. Deduplication (line, column, token)
    final_diagnostics = deduplicate_diagnostics(diagnostics)

    # 6. Save to Statement-level Cache
    with _CACHE_LOCK:
        if len(_SYNTAX_CACHE) >= CACHE_MAX_SIZE:
            # Purge oldest entries
            oldest_keys = sorted(_SYNTAX_CACHE.keys(), key=lambda k: _SYNTAX_CACHE[k].timestamp)[:64]
            for ok in oldest_keys:
                _SYNTAX_CACHE.pop(ok, None)

        _SYNTAX_CACHE[cache_key] = _CacheEntry(
            timestamp=now,
            diagnostics=copy.deepcopy(final_diagnostics),
            connection_id=str(conn_id) if conn_id else None,
        )

    return final_diagnostics
