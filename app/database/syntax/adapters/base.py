# -*- coding: utf-8 -*-
"""
Base Syntax Adapter Interface.
Defines the contract for database dialect syntax parsers.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseSyntaxAdapter(ABC):
    """Abstract base class for all syntax adapters."""

    @abstractmethod
    def validate(
        self,
        sql: str,
        connection_session: Any = None,
        database: str | None = None,
        schema: str | None = None,
        is_debug: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Validate SQL syntax and return standardized diagnostic dictionaries.

        Returns a list of dicts with keys:
            - severity: 'error' | 'warning' | 'info'
            - message: str
            - code: str (e.g. 'SQL_SYNTAX_ERROR')
            - line: int (1-based)
            - column: int (1-based)
            - end_column: int (1-based)
            - token: str
            - offset: int | None
            - source: str ('sqlserver' | 'postgresql' | ...)
        """
        pass
