# -*- coding: utf-8 -*-
"""
PostgreSQL Static ResultShape Detector.
Extracts result sets and parameters from pg_proc metadata and function source code without executing code.
"""
import logging
from typing import Any, Dict, List, Optional

from .base import ResultShapeDetector
from .parser import parse_postgres_cursors
from ..models import ResultShape

logger = logging.getLogger("app.services.report_layout_gen.result_shape.postgresql")


class PostgresResultShapeDetector(ResultShapeDetector):

    def _get_connection_session(self):
        conns_dict = getattr(self.connection_manager, "_connections", {})
        if self.connection_id in conns_dict:
            return conns_dict[self.connection_id]
        clean_target = str(self.connection_id).strip().lower()
        for c in conns_dict.values():
            cfg = getattr(c, "config", {}) or {}
            cid = str(cfg.get("id") or getattr(c, "connection_id", "")).strip().lower()
            cname = str(cfg.get("name") or "").strip().lower()
            if cid == clean_target or cname == clean_target:
                return c
        try:
            return self.connection_manager.get("main", self.connection_id)
        except Exception:
            pass

        # Try to resolve from saved profiles and connect
        try:
            from app.services.settings_store import get_saved_connections
            from app.utils.crypto import decrypt_password
            saved = get_saved_connections(filter_groups=False) or []
            for p in saved:
                if not p or p.get("type") == "group_marker":
                    continue
                pid = str(p.get("id") or "").strip().lower()
                pname = str(p.get("name") or "").strip().lower()
                if pid == clean_target or pname == clean_target:
                    cfg = dict(p)
                    if cfg.get("password") and not cfg.get("trusted_connection"):
                        try:
                            cfg["password"] = decrypt_password(cfg["password"])
                        except Exception:
                            pass
                    conn, _ = self.connection_manager.create_or_get("main", cfg)
                    return conn
        except Exception as exc:
            logger.warning("Failed to resolve saved profile in PostgresResultShapeDetector: %s", exc)

        return None

    def _execute_query(self, sql: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
        conn = self._get_connection_session()
        if not conn:
            raise ValueError(f"Không tìm thấy kết nối ID '{self.connection_id}'.")
        adapter = getattr(conn, "adapter", None)
        if not adapter:
            raise ValueError(f"Kết nối '{self.connection_id}' không có database adapter.")
        if not getattr(adapter, "connection", None):
            adapter.connect()

        cur = adapter.connection.cursor()
        try:
            if params:
                cur.execute(sql, params)
            else:
                cur.execute(sql)

            if cur.description:
                cols = [col[0] for col in cur.description]
                raw_rows = cur.fetchall()
                dict_rows = []
                for r in (raw_rows or []):
                    row_dict = {}
                    for idx, col_name in enumerate(cols):
                        row_dict[col_name] = r[idx]
                    dict_rows.append(row_dict)
                return dict_rows
            return []
        finally:
            try:
                cur.close()
            except Exception:
                pass

    def list_routines(
        self,
        schema: Optional[str] = None,
        search: Optional[str] = None,
        database: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        target_schema = (schema.strip() if schema and schema.strip() else None) or "public"
        clean_search = search.strip() if search and search.strip() else None
        sql = """
        SELECT 
            r.routine_schema AS schema, 
            r.routine_name AS name, 
            CASE WHEN r.routine_type = 'PROCEDURE' THEN 'P' ELSE 'FN' END AS type,
            r.routine_type AS kind
        FROM information_schema.routines r
        WHERE r.routine_schema = %s
          AND (%s IS NULL OR r.routine_name ILIKE '%%' || %s || '%%')
        ORDER BY r.routine_name
        """
        try:
            return self._execute_query(sql, (target_schema, clean_search, clean_search))
        except Exception as exc:
            logger.warning("Failed to list PostgreSQL routines: %s", exc)
            return []

    def describe_routine(
        self,
        routine_name: str,
        schema: Optional[str] = None,
        database: Optional[str] = None,
    ) -> ResultShape:
        target_schema = schema or "public"

        # 1. Statically query parameters from information_schema.parameters
        param_sql = """
        SELECT 
            parameter_name, 
            data_type, 
            parameter_mode
        FROM information_schema.parameters
        WHERE specific_schema = %s AND specific_name = %s
        ORDER BY ordinal_position
        """
        input_params: List[Dict[str, Any]] = []
        output_params: List[Dict[str, Any]] = []

        try:
            param_rows = self._execute_query(param_sql, (target_schema, routine_name))
            for r in param_rows:
                p_name = r.get("parameter_name") or ""
                p_type = r.get("data_type") or "text"
                p_mode = (r.get("parameter_mode") or "IN").upper()

                info = {"name": p_name, "type": p_type}
                if p_mode in ("OUT", "INOUT"):
                    output_params.append(info)
                elif p_mode in ("IN", "INOUT"):
                    input_params.append(info)
        except Exception as exc:
            logger.warning("Failed to inspect parameters for PG routine %s: %s", routine_name, exc)

        # 2. Check if returns TABLE columns or refcursor
        result_sets: List[Dict[str, Any]] = []

        # Read function source definition
        src_sql = """
        SELECT p.prosrc, pg_get_function_result(p.oid) AS return_type
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = %s AND p.proname = %s
        """
        try:
            rows = self._execute_query(src_sql, (target_schema, routine_name))
            if rows:
                prosrc = rows[0].get("prosrc") or ""
                return_type = (rows[0].get("return_type") or "").upper()

                if "REFCURSOR" in return_type or "OPEN " in prosrc.upper():
                    # Parse OPEN <cursor> FOR SELECT ...
                    parsed_cursors = parse_postgres_cursors(prosrc)
                    if parsed_cursors:
                        result_sets = parsed_cursors

                # If TABLE(...) return type
                if not result_sets and "TABLE" in return_type:
                    # Query information_schema.routine_columns or parse return_type
                    # Example return_type: "TABLE(id integer, name text)"
                    cols = []
                    table_part = return_type[return_type.find("(") + 1 : return_type.rfind(")")]
                    for col_def in table_part.split(","):
                        parts = col_def.strip().split()
                        if parts:
                            cols.append({
                                "name": parts[0],
                                "type": parts[1] if len(parts) > 1 else "unknown",
                            })
                    if cols:
                        result_sets.append({
                            "index": 0,
                            "name": "Table0",
                            "columns": cols,
                        })
        except Exception as exc:
            logger.warning("Failed to inspect PG function source for %s: %s", routine_name, exc)

        return ResultShape(
            result_sets=result_sets,
            output_params=output_params,
            input_params=input_params,
        )
