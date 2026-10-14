"""PostgreSQL Source Code & Dynamic SQL Analyzer
Analyzes SQL text and PL/pgSQL routines for:
- Structured column and table references (Confidence: LIKELY)
- Token/regex heuristic references (Confidence: POSSIBLE)
- Dynamic SQL detection (EXECUTE, format, string concatenation)
- External dependencies (dblink, postgres_fdw, foreign tables)

Conforms to .SKILL/postgres_dependcy_graph.md (Sections 31-35)
and .SKILL/Dependency Catalog trong PostgreSQL.md.
"""

import re
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field

from .models import (
    Confidence,
    WarningInfo,
    ObjectType,
    RelationType,
    Node,
    Edge,
    DependencySource,
    make_node_id
)


@dataclass
class SourceAnalysisResult:
    """Outcome of lexical and semantic analysis on an object definition."""
    is_referenced: bool = False
    confidence: Confidence = Confidence.POSSIBLE
    relation: RelationType = RelationType.DEPENDS_ON
    snippets: List[str] = field(default_factory=list)
    warnings: List[WarningInfo] = field(default_factory=list)
    has_dynamic_sql: bool = False
    has_external_dependency: bool = False


class PostgresSourceAnalyzer:
    """Performs token and pattern analysis on PostgreSQL object source code."""

    # Dynamic SQL regex patterns
    DYNAMIC_EXECUTE_RE = re.compile(r'\bEXECUTE\b\s+[\'\"]?', re.IGNORECASE)
    DYNAMIC_FORMAT_RE = re.compile(r'\bformat\s*\(\s*[\'\"]?', re.IGNORECASE)
    DYNAMIC_CONCAT_RE = re.compile(r"(['\"][^'\"]*\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE)\b[^'\"]*['\"]\s*\|\||\|\|\s*['\"])", re.IGNORECASE)
    DYNAMIC_QUOTE_RE = re.compile(r'\b(quote_ident|quote_literal|quote_nullable)\s*\(', re.IGNORECASE)

    # External DB hints
    EXTERNAL_FDW_RE = re.compile(r'\b(postgres_fdw|dblink|dblink_exec|foreign\s+table|foreign\s+data\s+wrapper)\b', re.IGNORECASE)

    @classmethod
    def is_column_selected_from_table(
        cls,
        sql_text: str,
        target_table: str,
        target_column: str,
        target_schema: Optional[str] = None
    ) -> bool:
        """
        Determines whether the given SQL/DDL (View definition or routine body)
        actually SELECTs/projects the target column from the target table.

        Important: If the table/column is only referenced in a JOIN condition
        (e.g., JOIN b20customer c ON c.id = o.customer_id) or a WHERE clause,
        and NOT projected in the SELECT clause, this returns False.
        """
        if not sql_text or not target_table or not target_column:
            return False

        clean_table = target_table.strip().strip('"').lower()
        clean_column = target_column.strip().strip('"').lower()
        clean_schema = (target_schema or '').strip().strip('"').lower()

        # 1. AST Analysis via sqlglot
        try:
            import sqlglot
            from sqlglot import exp

            parsed = sqlglot.parse_one(sql_text, read="postgres")
            if parsed:
                for select_node in parsed.find_all(exp.Select):
                    # Check tables strictly in this SELECT scope (FROM and JOINs)
                    scope_tables = []
                    from_node = select_node.args.get("from_")
                    if from_node:
                        scope_tables.extend(from_node.find_all(exp.Table))
                    for j in (select_node.args.get("joins") or []):
                        scope_tables.extend(j.find_all(exp.Table))

                    table_aliases = set()
                    has_target_table = False

                    for t in scope_tables:
                        t_name = (t.name or "").strip('"').lower()
                        t_db = (t.db or "").strip('"').lower()
                        if t_name == clean_table:
                            if not clean_schema or not t_db or t_db == clean_schema:
                                has_target_table = True
                                table_aliases.add(t_name)
                                if t.alias:
                                    table_aliases.add(t.alias.strip('"').lower())

                    if not has_target_table:
                        continue

                    # Inspect SELECT projections
                    for s in select_node.selects:
                        # Check Star: * or alias.*
                        if s.is_star:
                            if isinstance(s, exp.Star):
                                return True
                            elif isinstance(s, exp.Column) and isinstance(s.this, exp.Star):
                                tbl_ref = (s.table or "").strip('"').lower()
                                if not tbl_ref or tbl_ref in table_aliases:
                                    return True

                        # Check Columns in this projection
                        for col in s.find_all(exp.Column):
                            col_name = (col.name or "").strip('"').lower()
                            tbl_ref = (col.table or "").strip('"').lower()
                            if col_name == clean_column:
                                if not tbl_ref or tbl_ref in table_aliases:
                                    return True
        except Exception:
            pass

        # 2. Regex fallback for complex procedural blocks (e.g. PL/pgSQL) or unparsed SQL
        clean_code = cls._strip_comments(sql_text)

        # Pattern to extract SELECT ... [INTO ...] FROM ... blocks
        select_from_pattern = re.compile(
            r'SELECT\s+(.+?)(?:\s+INTO\s+[^\s,]+)?\s+FROM\s+([^;]+?)(?:WHERE|HAVING|WINDOW|GROUP\s+BY|ORDER\s+BY|LIMIT|UNION|EXCEPT|INTERSECT|\)|\;|$)',
            re.IGNORECASE | re.DOTALL
        )

        for m in select_from_pattern.finditer(clean_code):
            proj_part = m.group(1).strip()
            from_part = m.group(2).strip()

            tbl_re = rf'\b(?:[a-zA-Z0-9_]+\.)?{re.escape(clean_table)}\b(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?'
            tbl_match = re.search(tbl_re, from_part, re.IGNORECASE)
            if not tbl_match:
                continue

            alias = tbl_match.group(1)
            valid_prefixes = [clean_table]
            if alias and alias.upper() not in ('ON', 'JOIN', 'WHERE', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL'):
                valid_prefixes.append(alias.lower())

            # Check for star: alias.* or *
            for pfx in valid_prefixes:
                if re.search(rf'\b{re.escape(pfx)}\s*\.\s*\*|\b\*\b', proj_part):
                    return True

            # Check for prefixed column: pfx.col
            for pfx in valid_prefixes:
                if re.search(rf'\b{re.escape(pfx)}\s*\.\s*"?{re.escape(clean_column)}"?\b', proj_part, re.IGNORECASE):
                    return True

            # Check for bare column name if no conflicting table prefix
            if re.search(rf'(?<!\.)\b"?{re.escape(clean_column)}"?\b', proj_part, re.IGNORECASE):
                return True

        return False

    @classmethod
    def analyze_source_for_column(
        cls,
        source_code: str,
        target_column: str,
        target_table: Optional[str] = None,
        target_schema: Optional[str] = None,
        object_name: Optional[str] = None
    ) -> SourceAnalysisResult:
        """
        Analyzes source code to determine if it references target_column.
        Also scans for dynamic SQL and external dependencies.
        """
        result = SourceAnalysisResult()
        if not source_code or not target_column:
            return result

        clean_code = cls._strip_comments(source_code)

        # 1. Check for Dynamic SQL patterns
        cls._detect_dynamic_sql(clean_code, result, object_name)

        # 2. Check for External dependencies (dblink / FDW)
        cls._detect_external_dependencies(clean_code, result, object_name)

        # 3. Check for Column references
        col_name = target_column.strip().lower()
        tbl_name = (target_table or "").strip().lower()
        sch_name = (target_schema or "").strip().lower()

        # Build precise regex patterns
        # Pattern A: Qualified reference e.g., table.column or schema.table.column
        if tbl_name:
            qualified_pattern = rf'\b(?:{re.escape(tbl_name)}\s*\.\s*)?{re.escape(col_name)}\b'
            strict_qualified = rf'\b{re.escape(tbl_name)}\s*\.\s*{re.escape(col_name)}\b'
        else:
            qualified_pattern = rf'\b{re.escape(col_name)}\b'
            strict_qualified = None

        lines = clean_code.splitlines()
        orig_lines = source_code.splitlines()
        matching_lines = []

        is_strictly_qualified = False
        if strict_qualified:
            for idx, line in enumerate(lines, start=1):
                clean_line = line.strip()
                if clean_line and re.search(strict_qualified, clean_line, re.IGNORECASE):
                    orig_snippet = orig_lines[idx - 1].strip() if idx - 1 < len(orig_lines) else clean_line
                    matching_lines.append(f"L{idx}: {orig_snippet}")
                    is_strictly_qualified = True

        if not matching_lines:
            # Check for bare column name match
            bare_col_pattern = rf'\b{re.escape(col_name)}\b'
            for idx, line in enumerate(lines, start=1):
                clean_line = line.strip()
                if clean_line and re.search(bare_col_pattern, clean_line, re.IGNORECASE):
                    orig_snippet = orig_lines[idx - 1].strip() if idx - 1 < len(orig_lines) else clean_line
                    matching_lines.append(f"L{idx}: {orig_snippet}")

        if matching_lines:
            result.is_referenced = True
            result.snippets = matching_lines[:5] # Top 5 snippets

            if is_strictly_qualified:
                result.confidence = Confidence.LIKELY
                result.relation = RelationType.USES_COLUMN
            else:
                result.confidence = Confidence.POSSIBLE
                result.relation = RelationType.USES_COLUMN
                result.warnings.append(WarningInfo(
                    type="UNQUALIFIED_REFERENCE",
                    level="INFO",
                    message=f"Column '{target_column}' is referenced without explicit table qualification in '{object_name or 'source'}'.",
                    details="This reference might refer to a local variable or another table with the same column name."
                ))
        elif result.has_dynamic_sql:
            # If dynamic SQL exists, the column could be accessed dynamically at runtime
            result.confidence = Confidence.UNKNOWN

        return result

    @classmethod
    def analyze_source_for_table(
        cls,
        source_code: str,
        target_table: str,
        target_schema: Optional[str] = None,
        object_name: Optional[str] = None
    ) -> SourceAnalysisResult:
        """
        Analyzes source code to determine if it references target_table.
        Also scans for dynamic SQL and external dependencies.
        """
        result = SourceAnalysisResult()
        if not source_code or not target_table:
            return result

        clean_code = cls._strip_comments(source_code)

        # 1. Check for Dynamic SQL patterns
        cls._detect_dynamic_sql(clean_code, result, object_name)

        # 2. Check for External dependencies (dblink / FDW)
        cls._detect_external_dependencies(clean_code, result, object_name)

        tbl_name = target_table.strip().lower()
        sch_name = (target_schema or "").strip().lower()

        # DML / DDL explicit patterns: FROM table, JOIN table, INTO table, UPDATE table
        strict_pattern = rf'\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:{re.escape(sch_name)}\s*\.\s*)?{re.escape(tbl_name)}\b'
        general_pattern = rf'\b(?:{re.escape(sch_name)}\s*\.\s*)?{re.escape(tbl_name)}\b'

        lines = clean_code.splitlines()
        orig_lines = source_code.splitlines()
        matching_lines = []
        is_strict = False

        for idx, line in enumerate(lines, start=1):
            clean_line = line.strip()
            if not clean_line:
                continue
            if re.search(strict_pattern, clean_line, re.IGNORECASE):
                orig_snippet = orig_lines[idx - 1].strip() if idx - 1 < len(orig_lines) else clean_line
                matching_lines.append(f"L{idx}: {orig_snippet}")
                is_strict = True

        if not matching_lines:
            for idx, line in enumerate(lines, start=1):
                clean_line = line.strip()
                if not clean_line:
                    continue
                if re.search(general_pattern, clean_line, re.IGNORECASE):
                    orig_snippet = orig_lines[idx - 1].strip() if idx - 1 < len(orig_lines) else clean_line
                    matching_lines.append(f"L{idx}: {orig_snippet}")

        if matching_lines:
            result.is_referenced = True
            result.snippets = matching_lines[:5]
            result.confidence = Confidence.LIKELY if is_strict else Confidence.POSSIBLE
            result.relation = RelationType.USES_TABLE

        return result


    @classmethod
    def _detect_dynamic_sql(cls, code: str, result: SourceAnalysisResult, object_name: Optional[str]) -> None:
        """Inspects source code for dynamic SQL statements."""
        found_dyn = False
        details = []

        if cls.DYNAMIC_EXECUTE_RE.search(code):
            found_dyn = True
            details.append("Uses 'EXECUTE' statement")
        if cls.DYNAMIC_FORMAT_RE.search(code):
            found_dyn = True
            details.append("Uses 'format()' string formatting")
        if cls.DYNAMIC_CONCAT_RE.search(code):
            found_dyn = True
            details.append("Uses string concatenation (||) in queries")
        if cls.DYNAMIC_QUOTE_RE.search(code):
            found_dyn = True
            details.append("Uses dynamic identifier quotation (quote_ident)")

        if found_dyn:
            result.has_dynamic_sql = True
            obj_label = f" in '{object_name}'" if object_name else ""
            result.warnings.append(WarningInfo(
                type="DYNAMIC_SQL",
                level="WARNING",
                message=f"Dynamic SQL detected{obj_label}: {', '.join(details)}.",
                details="Dynamic SQL may construct column/table names at runtime that cannot be tracked in pg_depend catalog."
            ))

    @classmethod
    def _detect_external_dependencies(cls, code: str, result: SourceAnalysisResult, object_name: Optional[str]) -> None:
        """Inspects source code for external DB references."""
        match = cls.EXTERNAL_FDW_RE.search(code)
        if match:
            result.has_external_dependency = True
            obj_label = f" in '{object_name}'" if object_name else ""
            result.warnings.append(WarningInfo(
                type="EXTERNAL_DEPENDENCY",
                level="INFO",
                message=f"External database connection detected{obj_label} ({match.group(0)}).",
                details="References via dblink or postgres_fdw connect to external databases beyond local catalog."
            ))

    @staticmethod
    def _strip_comments(code: str) -> str:
        """Removes single-line -- and multi-line /* */ comments while preserving newlines."""
        def replace_block(match):
            return '\n' * match.group(0).count('\n')

        no_block = re.sub(r'/\*.*?\*/', replace_block, code, flags=re.DOTALL)
        no_single = re.sub(r'--[^\r\n]*', '', no_block)
        return no_single

    @staticmethod
    def _strip_line_comments(line: str) -> str:
        """Removes single-line comments from one line."""
        idx = line.find('--')
        return line[:idx] if idx != -1 else line

