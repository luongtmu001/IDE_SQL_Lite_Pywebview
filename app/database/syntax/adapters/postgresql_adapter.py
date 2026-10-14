# -*- coding: utf-8 -*-
"""
PostgreSQL Syntax Adapter.
Implements the Hybrid Strategy for PostgreSQL:
- Online Mode (connection available): Database-native Transaction Rollback with statement_position,
  providing 100% full validation of both declarative SQL and procedural PL/pgSQL (DO $$ blocks).
- Offline Mode (no connection): Static AST parsing via sqlglot with structural statement checks.
- Debug Mode: Preserves bs.* debug function masking and diagnostics filtering.

Complies with Section 4.2 & 6.2 of .SKILL/SQL_Syntax_Check_Parser_Extension.md.
"""
from __future__ import annotations

import logging
from typing import Any

from app.database.syntax.adapters.base import BaseSyntaxAdapter
from app.database.syntax.adapters.diagnostics_mapper import normalize_diagnostic

logger = logging.getLogger(__name__)


import re

def check_offline_postgres_structural_blocks(sql: str) -> list[dict[str, Any]]:
    """Check structural block balance for PostgreSQL when offline."""
    diags: list[dict[str, Any]] = []
    if not sql:
        return diags

    # 1. Check unclosed dollar-quoted blocks
    dollar_matches = list(re.finditer(r"\$[a-zA-Z0-9_]*\$", sql))
    if len(dollar_matches) % 2 == 1:
        last = dollar_matches[-1]
        line_no = sql[: last.start()].count("\n") + 1
        last_nl = sql[: last.start()].rfind("\n")
        col = (last.start() + 1) if last_nl == -1 else (last.start() - last_nl)
        tag = last.group(0)
        diags.append({
            "severity": "error",
            "message": f"Unclosed dollar-quoted block '{tag}'",
            "code": "SQL_SYNTAX_ERROR",
            "line": line_no,
            "column": col,
            "end_column": col + len(tag),
            "token": tag,
            "source": "postgresql",
        })
        return diags

    # 2. Check BEGIN / END pairs inside procedural dollar-quote blocks
    for i in range(0, len(dollar_matches), 2):
        start_m = dollar_matches[i]
        end_m = dollar_matches[i + 1]
        block = sql[start_m.end() : end_m.start()]

        # Clean single-line comments and single-quoted strings
        cleaned = re.sub(r"--[^\r\n]*", "", block)
        cleaned = re.sub(r"'(?:''|[^'])*'", "", cleaned)

        begins = list(re.finditer(r"\bBEGIN\b", cleaned, re.IGNORECASE))
        ends = list(re.finditer(r"\bEND\b", cleaned, re.IGNORECASE))
        if len(begins) > len(ends):
            unmatched = begins[len(ends)]
            abs_pos = start_m.end() + unmatched.start()
            line_no = sql[:abs_pos].count("\n") + 1
            last_nl = sql[:abs_pos].rfind("\n")
            col = (abs_pos + 1) if last_nl == -1 else (abs_pos - last_nl)
            diags.append({
                "severity": "error",
                "message": "Unmatched BEGIN block: missing corresponding END in procedural code",
                "code": "SQL_SYNTAX_ERROR",
                "line": line_no,
                "column": col,
                "end_column": col + 5,
                "token": "BEGIN",
                "source": "postgresql",
            })

    return diags


class PostgreSqlAdapter(BaseSyntaxAdapter):
    """
    PostgreSQL Syntax Adapter using Hybrid (Native Live Rollback + Offline Parser).
    Provides accurate statement_position parsing without database side-effects.
    """

    def validate(
        self,
        sql: str,
        connection_session: Any = None,
        database: str | None = None,
        schema: str | None = None,
        is_debug: bool = False,
    ) -> list[dict[str, Any]]:
        """Validate PostgreSQL syntax."""
        if not sql or not sql.strip():
            return []

        from app.database.syntax.validator import validate_postgresql

        raw_diags = validate_postgresql(
            sql=sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
        )

        # In offline mode, supplement sqlglot with structural block validation
        has_active_conn = False
        if connection_session and getattr(connection_session, "adapter", None):
            has_active_conn = getattr(connection_session.adapter, "connection", None) is not None

        if not has_active_conn:
            block_diags = check_offline_postgres_structural_blocks(sql)
            raw_diags.extend(block_diags)

        # Standardize diagnostics
        normalized = [
            normalize_diagnostic(d, default_source="postgresql", sql=sql)
            for d in raw_diags
        ]
        return normalized
