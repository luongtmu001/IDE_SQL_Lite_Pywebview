"""
SQL Syntax Validation Package for IDE-SQL-Lite.
Provides validation without side-effects for SQL Server (T-SQL) and PostgreSQL.
Reference: .SKILL/sytax_check.md
"""

from .validator import validate_sql, split_sqlserver_batches
from .coordinator import validate_sql_pipeline

__all__ = ["validate_sql", "split_sqlserver_batches", "validate_sql_pipeline"]
