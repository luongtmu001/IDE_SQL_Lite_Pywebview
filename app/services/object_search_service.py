# -*- coding: utf-8 -*-
"""
Object Content Search Service.
Searches inside DDL/definitions of SQL Objects (Views, Procedures, Functions, Triggers)
and extracts matching locations (line, column, text snippet) for Monaco highlight and navigation.
"""
import re
from typing import Any, Dict, List, Optional


class ObjectSearchService:

    def __init__(self, adapter):
        self.adapter = adapter

    def _compile_pattern(self, keyword: str, case_sensitive: bool = False, whole_word: bool = False, is_regex: bool = False) -> Optional[re.Pattern]:
        if not keyword:
            return None
        flags = 0 if case_sensitive else re.IGNORECASE
        if is_regex:
            return re.compile(keyword, flags)
        if whole_word:
            pattern = r'(?<!\w)' + re.escape(keyword) + r'(?!\w)'
            return re.compile(pattern, flags)
        return re.compile(re.escape(keyword), flags)

    def search(
        self,
        keyword: str,
        database: Optional[str] = None,
        object_types: Optional[List[str]] = None,
        case_sensitive: bool = False,
        whole_word: bool = False,
        is_regex: bool = False,
        schema: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Search for objects containing keyword in their definition.
        Returns list of metadata: {schema, name, type, match_count}.
        Does NOT return full DDLs to keep response lightweight.
        """
        if not keyword or not keyword.strip():
            return {
                "success": True,
                "total_objects": 0,
                "total_matches": 0,
                "objects": []
            }

        keyword = keyword.strip()
        try:
            compiled_re = self._compile_pattern(keyword, case_sensitive, whole_word, is_regex)
        except re.error as exc:
            return {
                "success": False,
                "error": f"Invalid regular expression: {str(exc)}"
            }

        # Normalize object types
        valid_types = {"VIEW", "PROCEDURE", "FUNCTION", "TRIGGER"}
        if not object_types:
            requested_types = valid_types
        else:
            requested_types = {t.upper().strip() for t in object_types if t.upper().strip() in valid_types}
            if not requested_types:
                requested_types = valid_types

        db_type = getattr(self.adapter, "db_type", "sqlserver").lower()

        if "postgres" in db_type:
            raw_objects = self._search_postgres_raw(database, keyword, requested_types, schema, is_regex)
        else:
            raw_objects = self._search_sqlserver_raw(database, keyword, requested_types, schema, is_regex)

        matched_results = []
        total_matches = 0
        seen_keys = set()

        for item in raw_objects:
            s_name = item.get("schema") or "dbo"
            o_name = item.get("name") or ""
            o_type = item.get("type") or "OBJECT"
            defn = item.get("definition")

            if not defn or not o_name:
                continue

            dedup_key = (s_name.lower(), o_name.lower(), o_type.upper())
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            matches = list(compiled_re.finditer(defn))
            count = len(matches)
            if count > 0:
                total_matches += count
                matched_results.append({
                    "schema": s_name,
                    "name": o_name,
                    "type": o_type,
                    "match_count": count
                })

        # Default Sort: Object Type -> Schema -> Object Name
        type_order = {"VIEW": 1, "PROCEDURE": 2, "FUNCTION": 3, "TRIGGER": 4}
        matched_results.sort(key=lambda x: (type_order.get(x["type"], 99), x["schema"].lower(), x["name"].lower()))

        return {
            "success": True,
            "total_objects": len(matched_results),
            "total_matches": total_matches,
            "objects": matched_results
        }

    def get_ddl(
        self,
        schema: str,
        name: str,
        object_type: str,
        database: Optional[str] = None,
        keyword: Optional[str] = None,
        case_sensitive: bool = False,
        whole_word: bool = False,
        is_regex: bool = False
    ) -> Dict[str, Any]:
        """
        Retrieve DDL for a single object and calculate match locations (line, col, snippet).
        """
        db_type = getattr(self.adapter, "db_type", "sqlserver").lower()
        clean_schema = (schema or "dbo").strip("[] \t\r\n")
        clean_name = (name or "").strip("[] \t\r\n")
        norm_type = (object_type or "VIEW").upper().strip()

        definition = None
        permission_issue = False

        try:
            if "postgres" in db_type:
                definition = self.adapter.get_object_definition(database, clean_schema, clean_name, norm_type.lower())
            else:
                definition = self._get_sqlserver_definition(database, clean_schema, clean_name, norm_type)
        except Exception as exc:
            err_str = str(exc).lower()
            if "permission" in err_str or "denied" in err_str or "forbidden" in err_str:
                permission_issue = True
            else:
                return {
                    "success": False,
                    "error": f"Failed to retrieve object definition: {str(exc)}"
                }

        if definition is None:
            return {
                "success": True,
                "schema": clean_schema,
                "name": clean_name,
                "type": norm_type,
                "ddl": None,
                "error": "Definition is unavailable because the current user does not have permission to view this object definition." if permission_issue else "Definition is empty or unavailable for this object.",
                "matches": [],
                "total_matches": 0
            }

        # Calculate matches
        matches = []
        if keyword and keyword.strip():
            kw = keyword.strip()
            try:
                compiled_re = self._compile_pattern(kw, case_sensitive, whole_word, is_regex)
            except re.error:
                compiled_re = None

            if compiled_re:
                # Split lines while tracking 1-based line numbers
                lines = definition.splitlines()
                for line_idx, line_text in enumerate(lines, start=1):
                    for m in compiled_re.finditer(line_text):
                        matches.append({
                            "line": line_idx,
                            "column": m.start() + 1,
                            "length": m.end() - m.start(),
                            "text": line_text.strip()
                        })

        return {
            "success": True,
            "schema": clean_schema,
            "name": clean_name,
            "type": norm_type,
            "ddl": definition,
            "matches": matches,
            "total_matches": len(matches)
        }

    # === Internal SQL Server Search ===

    def _search_sqlserver_raw(
        self,
        database: Optional[str],
        keyword: str,
        requested_types: set,
        schema_filter: Optional[str],
        is_regex: bool
    ) -> List[Dict[str, Any]]:
        clean_db = str(database).replace("]", "]]") if database else None
        db_prefix = f"[{clean_db}]." if clean_db else ""

        # Map types to SQL Server codes
        queries = []
        params = []

        # Prepare LIKE optimization if not regex
        like_filter = ""
        like_param = None
        if not is_regex and len(keyword) <= 200:
            # Escape wildcards for LIKE
            escaped_kw = keyword.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
            like_filter = " AND sm.definition LIKE ? "
            like_param = f"%{escaped_kw}%"

        # 1. Views, Procedures, Functions
        regular_type_codes = []
        if "VIEW" in requested_types:
            regular_type_codes.append("'V'")
        if "PROCEDURE" in requested_types:
            regular_type_codes.extend(["'P'", "'PC'"])
        if "FUNCTION" in requested_types:
            regular_type_codes.extend(["'FN'", "'IF'", "'TF'", "'FS'", "'FT'"])

        if regular_type_codes:
            code_in = ", ".join(regular_type_codes)
            q1 = f"""
                SELECT 
                    s.name AS [schema],
                    o.name AS [name],
                    CASE 
                        WHEN o.type = 'V' THEN 'VIEW'
                        WHEN o.type IN ('P', 'PC') THEN 'PROCEDURE'
                        ELSE 'FUNCTION'
                    END AS [type],
                    sm.definition
                FROM {db_prefix}sys.sql_modules AS sm
                JOIN {db_prefix}sys.objects AS o ON o.object_id = sm.object_id
                JOIN {db_prefix}sys.schemas AS s ON s.schema_id = o.schema_id
                WHERE sm.definition IS NOT NULL
                  AND o.is_ms_shipped = 0
                  AND o.type IN ({code_in})
            """
            q1_params = []
            if schema_filter:
                q1 += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                q1_params.extend([schema_filter, schema_filter])
            if like_filter and like_param:
                q1 += like_filter
                q1_params.append(like_param)
            queries.append((q1, q1_params))

        # 2. Triggers
        if "TRIGGER" in requested_types:
            q2 = f"""
                SELECT 
                    s.name AS [schema],
                    tr.name AS [name],
                    'TRIGGER' AS [type],
                    sm.definition
                FROM {db_prefix}sys.sql_modules AS sm
                JOIN {db_prefix}sys.triggers AS tr ON tr.object_id = sm.object_id
                JOIN {db_prefix}sys.objects AS parent ON parent.object_id = tr.parent_id
                JOIN {db_prefix}sys.schemas AS s ON s.schema_id = parent.schema_id
                WHERE sm.definition IS NOT NULL
                  AND tr.is_ms_shipped = 0
            """
            q2_params = []
            if schema_filter:
                q2 += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                q2_params.extend([schema_filter, schema_filter])
            if like_filter and like_param:
                q2 += like_filter
                q2_params.append(like_param)
            queries.append((q2, q2_params))

        results = []
        for sql, p_list in queries:
            try:
                res = self.adapter.execute(sql, tuple(p_list) if p_list else None, database=database)
                for row in res.get("rows", []):
                    if len(row) >= 4 and row[3]:
                        results.append({
                            "schema": row[0],
                            "name": row[1],
                            "type": row[2],
                            "definition": row[3]
                        })
            except Exception as exc:
                # If error occurred with db_prefix, try fallback without prefix if database is selected
                if database:
                    try:
                        sql_no_prefix = sql.replace(db_prefix, "")
                        res = self.adapter.execute(sql_no_prefix, tuple(p_list) if p_list else None, database=database)
                        for row in res.get("rows", []):
                            if len(row) >= 4 and row[3]:
                                results.append({
                                    "schema": row[0],
                                    "name": row[1],
                                    "type": row[2],
                                    "definition": row[3]
                                })
                    except Exception:
                        pass
        return results

    def _get_sqlserver_definition(
        self,
        database: Optional[str],
        schema: str,
        name: str,
        object_type: str
    ) -> Optional[str]:
        clean_db = str(database).replace("]", "]]") if database else None
        db_prefix = f"[{clean_db}]." if clean_db else ""

        if object_type == "TRIGGER":
            sql = f"""
                SELECT sm.definition
                FROM {db_prefix}sys.sql_modules AS sm
                JOIN {db_prefix}sys.triggers AS tr ON tr.object_id = sm.object_id
                JOIN {db_prefix}sys.objects AS parent ON parent.object_id = tr.parent_id
                JOIN {db_prefix}sys.schemas AS s ON s.schema_id = parent.schema_id
                WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
                  AND (tr.name = ? OR LOWER(tr.name) = LOWER(?))
            """
            res = self.adapter.execute(sql, (schema, schema, name, name), database=database)
            if res.get("rows") and res["rows"][0][0]:
                return res["rows"][0][0]

            # Fallback by trigger name alone
            fb_sql = f"""
                SELECT sm.definition
                FROM {db_prefix}sys.sql_modules AS sm
                JOIN {db_prefix}sys.triggers AS tr ON tr.object_id = sm.object_id
                WHERE tr.name = ? OR LOWER(tr.name) = LOWER(?)
            """
            res = self.adapter.execute(fb_sql, (name, name), database=database)
            if res.get("rows") and res["rows"][0][0]:
                return res["rows"][0][0]

        # Views, Procedures, Functions
        sql = f"""
            SELECT sm.definition
            FROM {db_prefix}sys.sql_modules AS sm
            JOIN {db_prefix}sys.objects AS o ON o.object_id = sm.object_id
            JOIN {db_prefix}sys.schemas AS s ON s.schema_id = o.schema_id
            WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
              AND (o.name = ? OR LOWER(o.name) = LOWER(?))
        """
        res = self.adapter.execute(sql, (schema, schema, name, name), database=database)
        if res.get("rows") and res["rows"][0][0]:
            return res["rows"][0][0]

        # Use adapter fallback
        return self.adapter.get_object_definition(database, schema, name, object_type.lower())

    # === Internal PostgreSQL Search ===

    def _search_postgres_raw(
        self,
        database: Optional[str],
        keyword: str,
        requested_types: set,
        schema_filter: Optional[str],
        is_regex: bool
    ) -> List[Dict[str, Any]]:
        results = []

        # Normalize schema filter ('*' or empty means all schemas)
        clean_schema = None
        if schema_filter:
            s_clean = schema_filter.strip()
            if s_clean.lower() not in ('*', '', 'all', 'all schemas', 'all schemas (*)', 'none', 'null', 'all schema'):
                clean_schema = s_clean

        # 1. Functions & Procedures
        if "FUNCTION" in requested_types or "PROCEDURE" in requested_types:
            type_clauses = []
            if "FUNCTION" in requested_types:
                type_clauses.append("p.prokind IN ('f', 'w')")
            if "PROCEDURE" in requested_types:
                type_clauses.append("p.prokind = 'p'")
            kind_clause = f"AND ({' OR '.join(type_clauses)})" if type_clauses else ""

            sql = f"""
                SELECT 
                    n.nspname AS schema,
                    p.proname AS name,
                    CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS type,
                    CASE 
                        WHEN l.lanname IN ('c', 'internal') THEN p.prosrc
                        ELSE COALESCE(pg_catalog.pg_get_functiondef(p.oid), p.prosrc)
                    END AS definition
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
                WHERE LEFT(n.nspname, 3) != 'pg_'
                  AND n.nspname != 'information_schema'
                  AND (l.lanname IS NULL OR l.lanname NOT IN ('c', 'internal'))
                  {kind_clause}
            """
            params = []
            if clean_schema:
                sql += " AND (n.nspname = %s OR lower(n.nspname) = lower(%s))"
                params.extend([clean_schema, clean_schema])
            if not is_regex:
                sql += " AND (p.prosrc ILIKE %s OR p.proname ILIKE %s OR pg_catalog.pg_get_functiondef(p.oid) ILIKE %s)"
                params.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])

            try:
                res = self.adapter.execute(sql, tuple(params) if params else None, database=database)
                for row in res.get("rows", []):
                    if len(row) >= 4 and row[3]:
                        results.append({
                            "schema": row[0],
                            "name": row[1],
                            "type": row[2],
                            "definition": row[3]
                        })
            except Exception as exc:
                # Resilient fallback: search directly via prosrc
                try:
                    fallback_sql = f"""
                        SELECT 
                            n.nspname AS schema,
                            p.proname AS name,
                            CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS type,
                            p.prosrc AS definition
                        FROM pg_catalog.pg_proc p
                        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                        WHERE LEFT(n.nspname, 3) != 'pg_'
                          AND n.nspname != 'information_schema'
                          {kind_clause}
                    """
                    fb_params = []
                    if clean_schema:
                        fallback_sql += " AND (n.nspname = %s OR lower(n.nspname) = lower(%s))"
                        fb_params.extend([clean_schema, clean_schema])
                    if not is_regex:
                        fallback_sql += " AND (p.prosrc ILIKE %s OR p.proname ILIKE %s)"
                        fb_params.extend([f"%{keyword}%", f"%{keyword}%"])
                    fb_res = self.adapter.execute(fallback_sql, tuple(fb_params) if fb_params else None, database=database)
                    for row in fb_res.get("rows", []):
                        if len(row) >= 4 and row[3]:
                            results.append({
                                "schema": row[0],
                                "name": row[1],
                                "type": row[2],
                                "definition": row[3]
                            })
                except Exception:
                    pass

        # 2. Views (Fast query via pg_views & pg_matviews)
        if "VIEW" in requested_types:
            sql = """
                SELECT 
                    v.schemaname AS schema,
                    v.viewname AS name,
                    'VIEW' AS type,
                    'CREATE OR REPLACE VIEW "' || v.schemaname || '"."' || v.viewname || '" AS\n' || v.definition AS definition
                FROM pg_catalog.pg_views v
                WHERE LEFT(v.schemaname, 3) != 'pg_'
                  AND v.schemaname != 'information_schema'
            """
            params = []
            if clean_schema:
                sql += " AND (v.schemaname = %s OR lower(v.schemaname) = lower(%s))"
                params.extend([clean_schema, clean_schema])
            if not is_regex:
                sql += " AND (v.viewname ILIKE %s OR v.definition ILIKE %s)"
                params.extend([f"%{keyword}%", f"%{keyword}%"])

            try:
                res = self.adapter.execute(sql, tuple(params) if params else None, database=database)
                for row in res.get("rows", []):
                    if len(row) >= 4 and row[3]:
                        results.append({
                            "schema": row[0],
                            "name": row[1],
                            "type": "VIEW",
                            "definition": row[3]
                        })
            except Exception:
                pass

            # Materialized views
            mat_sql = """
                SELECT 
                    m.schemaname AS schema,
                    m.matviewname AS name,
                    'VIEW' AS type,
                    'CREATE MATERIALIZED VIEW "' || m.schemaname || '"."' || m.matviewname || '" AS\n' || m.definition AS definition
                FROM pg_catalog.pg_matviews m
                WHERE LEFT(m.schemaname, 3) != 'pg_'
                  AND m.schemaname != 'information_schema'
            """
            mat_params = []
            if clean_schema:
                mat_sql += " AND (m.schemaname = %s OR lower(m.schemaname) = lower(%s))"
                mat_params.extend([clean_schema, clean_schema])
            if not is_regex:
                mat_sql += " AND (m.matviewname ILIKE %s OR m.definition ILIKE %s)"
                mat_params.extend([f"%{keyword}%", f"%{keyword}%"])

            try:
                res = self.adapter.execute(mat_sql, tuple(mat_params) if mat_params else None, database=database)
                for row in res.get("rows", []):
                    if len(row) >= 4 and row[3]:
                        results.append({
                            "schema": row[0],
                            "name": row[1],
                            "type": "VIEW",
                            "definition": row[3]
                        })
            except Exception:
                pass

        # 3. Triggers
        if "TRIGGER" in requested_types:
            sql = """
                SELECT 
                    n.nspname AS schema,
                    t.tgname AS name,
                    'TRIGGER' AS type,
                    pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
                FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE NOT t.tgisinternal
                  AND LEFT(n.nspname, 3) != 'pg_'
                  AND n.nspname != 'information_schema'
            """
            params = []
            if clean_schema:
                sql += " AND (n.nspname = %s OR lower(n.nspname) = lower(%s))"
                params.extend([clean_schema, clean_schema])
            if not is_regex:
                sql += " AND (t.tgname ILIKE %s OR pg_catalog.pg_get_triggerdef(t.oid, true) ILIKE %s)"
                params.extend([f"%{keyword}%", f"%{keyword}%"])

            try:
                res = self.adapter.execute(sql, tuple(params) if params else None, database=database)
                for row in res.get("rows", []):
                    if len(row) >= 4 and row[3]:
                        results.append({
                            "schema": row[0],
                            "name": row[1],
                            "type": "TRIGGER",
                            "definition": row[3]
                        })
            except Exception:
                pass

        return results
