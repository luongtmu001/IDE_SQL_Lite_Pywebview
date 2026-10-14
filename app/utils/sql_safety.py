# -*- coding: utf-8 -*-
"""
SQL Safety and Environment Protection Engine.
Provides:
- Statement classification (Read-only vs DML / DDL / Modifying) via sqlglot with regex fallback.
- Read-only connection enforcement.
- Production environment confirmation guard.
"""

import re
from typing import Dict, Any, List, Optional
import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

_MODIFYING_EXPRESSION_TYPES = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.TruncateTable,
    exp.Merge,
)

# Regex fallback for non-standard / dialect-specific statements
_DML_DDL_KEYWORD_PATTERN = re.compile(
    r'(?i)\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DELETE|TRUNCATE\s+TABLE|TRUNCATE|'
    r'CREATE\s+TABLE|CREATE\s+VIEW|CREATE\s+PROCEDURE|CREATE\s+FUNCTION|CREATE\s+INDEX|'
    r'ALTER\s+TABLE|ALTER\s+VIEW|ALTER\s+PROCEDURE|ALTER\s+FUNCTION|ALTER\s+INDEX|'
    r'DROP\s+TABLE|DROP\s+VIEW|DROP\s+PROCEDURE|DROP\s+FUNCTION|DROP\s+INDEX|DROP|'
    r'MERGE\s+INTO|MERGE|EXEC\b|EXECUTE\b|CALL\b)\b'
)

_SELECT_INTO_PATTERN = re.compile(r'(?i)\bSELECT\b[\s\S]*?\bINTO\b[\s\S]*?\bFROM\b')


def _strip_comments_and_strings(sql: str) -> str:
    """Removes single-line/multi-line comments and quoted string literals from SQL text."""
    if not sql:
        return ""
    # Remove block comments
    no_block = re.sub(r'/\*[\s\S]*?\*/', ' ', sql)
    # Remove line comments
    no_line = re.sub(r'--[^\r\n]*', ' ', no_block)
    # Remove string literals
    no_strings = re.sub(r"'(''|[^'])*'", "''", no_line)
    return no_strings


def classify_statement(sql: str, dialect: str = "tsql") -> Dict[str, Any]:
    """
    Classifies an SQL string into Read-Only or Modifying.
    Returns:
    {
        "is_read_only": bool,
        "statement_type": str,   # "SELECT", "DML", "DDL", "EXPLAIN", "SHOW", "EXEC", or "UNKNOWN"
        "detected_actions": list, # e.g. ["DELETE", "SELECT_INTO"]
        "raw_count": int
    }
    """
    if not sql or not sql.strip():
        return {
            "is_read_only": True,
            "statement_type": "EMPTY",
            "detected_actions": [],
            "raw_count": 0
        }

    clean_sql = sql.strip()
    stripped = _strip_comments_and_strings(clean_sql)
    words = stripped.split()
    first_word = words[0].upper() if words else ""

    # Quick check for diagnostic read-only commands (EXPLAIN, SHOW, DESCRIBE, DESC)
    if first_word in ("EXPLAIN", "SHOW", "DESCRIBE", "DESC"):
        return {
            "is_read_only": True,
            "statement_type": first_word,
            "detected_actions": [],
            "raw_count": 1
        }

    norm_dialect = "tsql" if "sqlserver" in dialect.lower() or "mssql" in dialect.lower() else (
        "postgres" if "postgre" in dialect.lower() else dialect
    )

    detected_actions: List[str] = []
    is_modifying = False

    # Check for T-SQL SELECT ... INTO
    if _SELECT_INTO_PATTERN.search(stripped):
        detected_actions.append("SELECT_INTO")
        is_modifying = True

    try:
        expressions = sqlglot.parse(clean_sql, read=norm_dialect)
        parsed_successfully = bool(expressions)
    except ParseError:
        expressions = []
        parsed_successfully = False

    if parsed_successfully and expressions:
        for expr in expressions:
            if expr is None:
                continue

            # Check if root is Select
            if isinstance(expr, exp.Select):
                # Check for SELECT ... INTO clause
                if expr.find(exp.Into):
                    detected_actions.append("SELECT_INTO")
                    is_modifying = True
                # Check if CTE contains any modifying statements (INSERT/UPDATE/DELETE inside WITH)
                for modifying_type in (exp.Insert, exp.Update, exp.Delete):
                    if expr.find(modifying_type):
                        detected_actions.append(modifying_type.__name__.upper())
                        is_modifying = True
            elif hasattr(exp, "Show") and isinstance(expr, exp.Show):
                pass
            elif hasattr(exp, "Describe") and isinstance(expr, exp.Describe):
                pass
            elif isinstance(expr, _MODIFYING_EXPRESSION_TYPES):
                detected_actions.append(type(expr).__name__.upper())
                is_modifying = True
            elif isinstance(expr, exp.Command):
                cmd_this = str(getattr(expr, "this", "")).upper()
                if cmd_this.startswith(("EXEC", "CALL", "TRUNCATE", "DROP", "ALTER", "CREATE", "DELETE", "UPDATE", "INSERT")):
                    detected_actions.append("COMMAND")
                    is_modifying = True
            else:
                # Any other expression type: search for sub-modifying expressions
                for modifying_type in _MODIFYING_EXPRESSION_TYPES:
                    if expr.find(modifying_type):
                        detected_actions.append(modifying_type.__name__.upper())
                        is_modifying = True
                        break
    else:
        # Fallback to regex analysis
        matches = _DML_DDL_KEYWORD_PATTERN.findall(stripped)
        if matches:
            is_modifying = True
            for m in matches:
                detected_actions.append(m.strip().upper())

    # Check regex as supplementary safeguard (e.g. EXEC in T-SQL or DROP TABLE)
    if not is_modifying:
        matches = _DML_DDL_KEYWORD_PATTERN.findall(stripped)
        if matches:
            is_modifying = True
            for m in matches:
                detected_actions.append(m.strip().upper())

    # Determine broad statement type
    if not is_modifying:
        if first_word in ("SELECT", "WITH"):
            stmt_type = "SELECT"
        elif first_word in ("EXPLAIN", "SHOW", "DESCRIBE", "DESC"):
            stmt_type = first_word
        else:
            stmt_type = "READ_ONLY"
    else:
        if any(a.startswith("CREATE") or a.startswith("ALTER") or a.startswith("DROP") for a in detected_actions):
            stmt_type = "DDL"
        elif any(a.startswith("EXEC") or a.startswith("CALL") for a in detected_actions):
            stmt_type = "EXEC"
        else:
            stmt_type = "DML"

    return {
        "is_read_only": not is_modifying,
        "statement_type": stmt_type,
        "detected_actions": list(set(detected_actions)),
        "raw_count": len(expressions) if parsed_successfully else 1
    }


def check_query_safety(
    sql: str,
    read_only: bool = False,
    environment: Optional[str] = None,
    confirmed: bool = False,
    dialect: str = "tsql"
) -> Dict[str, Any]:
    """
    Validates query against read_only mode and production environment constraints.
    Returns:
    {
        "allowed": bool,
        "needs_confirmation": bool,
        "error_code": Optional[str],
        "message": Optional[str],
        "classification": Dict[str, Any]
    }
    """
    classification = classify_statement(sql, dialect=dialect)

    # 1. Enforce Read-Only constraint
    if read_only and not classification["is_read_only"]:
        actions_str = ", ".join(classification["detected_actions"]) if classification["detected_actions"] else "sửa đổi dữ liệu"
        return {
            "allowed": False,
            "needs_confirmation": False,
            "error_code": "ERR_READ_ONLY",
            "message": f"Kết nối đang ở chế độ CHỈ ĐỌC (Read-Only). Lệnh bị chặn vì có thao tác ghi: {actions_str}.",
            "classification": classification
        }

    # 2. Enforce Production confirmation constraint
    env_str = str(environment or "").strip().lower()
    if env_str == "prod" and not classification["is_read_only"] and not confirmed:
        actions_str = ", ".join(classification["detected_actions"]) if classification["detected_actions"] else "DML / DDL"
        return {
            "allowed": False,
            "needs_confirmation": True,
            "error_code": "ERR_PROD_CONFIRMATION_REQUIRED",
            "message": f"Cảnh báo môi trường PRODUCTION: Thao tác sửa đổi dữ liệu [{actions_str}] yêu cầu xác nhận trước khi thực thi.",
            "classification": classification
        }

    return {
        "allowed": True,
        "needs_confirmation": False,
        "error_code": None,
        "message": None,
        "classification": classification
    }


def detect_fatal_actions(sql: str, dialect: str = "tsql") -> List[Dict[str, Any]]:
    """
    Detects fatal table modification actions:
    - DELETE without WHERE clause
    - UPDATE without WHERE clause
    - TRUNCATE (TRUNCATE TABLE / TRUNCATE)

    Returns a list of detected fatal action descriptors.
    """
    if not sql or not sql.strip():
        return []

    norm_dialect = "tsql" if "sqlserver" in dialect.lower() or "mssql" in dialect.lower() else (
        "postgres" if "postgre" in dialect.lower() else dialect
    )

    fatal_actions: List[Dict[str, Any]] = []

    try:
        expressions = sqlglot.parse(sql.strip(), read=norm_dialect)
        parsed_successfully = bool(expressions)
    except Exception:
        expressions = []
        parsed_successfully = False

    if parsed_successfully and expressions:
        for expr in expressions:
            if expr is None:
                continue

            # 1. DELETE without WHERE
            if isinstance(expr, exp.Delete):
                if not expr.args.get("where"):
                    fatal_actions.append({
                        "type": "DELETE_WITHOUT_WHERE",
                        "message": "Phát hiện câu lệnh DELETE không có mệnh đề WHERE",
                        "statement": expr.sql(dialect=norm_dialect)
                    })
            # 2. UPDATE without WHERE
            elif isinstance(expr, exp.Update):
                if not expr.args.get("where"):
                    fatal_actions.append({
                        "type": "UPDATE_WITHOUT_WHERE",
                        "message": "Phát hiện câu lệnh UPDATE không có mệnh đề WHERE",
                        "statement": expr.sql(dialect=norm_dialect)
                    })
            # 3. TRUNCATE TABLE
            elif isinstance(expr, exp.TruncateTable):
                fatal_actions.append({
                    "type": "TRUNCATE",
                    "message": "Phát hiện câu lệnh TRUNCATE TABLE",
                    "statement": expr.sql(dialect=norm_dialect)
                })
            elif isinstance(expr, exp.Command):
                cmd_this = str(getattr(expr, "this", "")).upper()
                if cmd_this.startswith("TRUNCATE"):
                    fatal_actions.append({
                        "type": "TRUNCATE",
                        "message": "Phát hiện câu lệnh TRUNCATE",
                        "statement": expr.sql(dialect=norm_dialect)
                    })
            else:
                for d_node in expr.find_all(exp.Delete):
                    if not d_node.args.get("where"):
                        fatal_actions.append({
                            "type": "DELETE_WITHOUT_WHERE",
                            "message": "Phát hiện câu lệnh DELETE không có mệnh đề WHERE",
                            "statement": d_node.sql(dialect=norm_dialect)
                        })
                for u_node in expr.find_all(exp.Update):
                    if not u_node.args.get("where"):
                        fatal_actions.append({
                            "type": "UPDATE_WITHOUT_WHERE",
                            "message": "Phát hiện câu lệnh UPDATE không có mệnh đề WHERE",
                            "statement": u_node.sql(dialect=norm_dialect)
                        })
                for t_node in expr.find_all(exp.TruncateTable):
                    fatal_actions.append({
                        "type": "TRUNCATE",
                        "message": "Phát hiện câu lệnh TRUNCATE TABLE",
                        "statement": t_node.sql(dialect=norm_dialect)
                    })

    # Regex fallback if parser failed or as supplementary check
    if not fatal_actions:
        stripped = _strip_comments_and_strings(sql)
        stmts = [s.strip() for s in re.split(r';|\bGO\b', stripped, flags=re.IGNORECASE) if s.strip()]
        for s in stmts:
            # Skip DDL table creation / foreign key constraints
            if re.search(r'(?i)\b(CREATE|ALTER)\s+TABLE\b', s):
                continue
            if re.search(r'(?i)\bTRUNCATE\s+(TABLE\s+)?[a-zA-Z0-9_#$@.\[\]]+', s):
                fatal_actions.append({
                    "type": "TRUNCATE",
                    "message": "Phát hiện câu lệnh TRUNCATE",
                    "statement": s
                })
            elif re.search(r'(?i)\bDELETE\s+(FROM\s+)?[a-zA-Z0-9_#$@.\[\]]+', s):
                if not re.search(r'(?i)\b(ON|BEFORE|AFTER)\s+DELETE\b', s) and not re.search(r'(?i)\bWHERE\b', s):
                    fatal_actions.append({
                        "type": "DELETE_WITHOUT_WHERE",
                        "message": "Phát hiện câu lệnh DELETE không có mệnh đề WHERE",
                        "statement": s
                    })
            elif re.search(r'(?i)\bUPDATE\s+[a-zA-Z0-9_#$@.\[\]]+\s+SET\b', s):
                if not re.search(r'(?i)\b(ON|BEFORE|AFTER)\s+UPDATE\b', s) and not re.search(r'(?i)\bWHERE\b', s):
                    fatal_actions.append({
                        "type": "UPDATE_WITHOUT_WHERE",
                        "message": "Phát hiện câu lệnh UPDATE không có mệnh đề WHERE",
                        "statement": s
                    })

    return fatal_actions


