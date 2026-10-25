# -*- coding: utf-8 -*-
"""
SQL Server Static ResultShape Detector.
Extracts result sets and parameters from metadata catalogs and DDL definitions without executing code.
"""
import logging
from typing import Any, Dict, List, Optional

from .base import ResultShapeDetector
from .parser import parse_sql_server_selects
from ..models import ResultShape

logger = logging.getLogger("app.services.report_layout_gen.result_shape.sqlserver")


class SqlServerResultShapeDetector(ResultShapeDetector):

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
            logger.warning("Failed to resolve saved profile in SqlServerResultShapeDetector: %s", exc)

        return None

    def _execute_query(
        self,
        sql: str,
        params: Optional[tuple] = None,
        database: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
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
            if database:
                clean_db = str(database).strip("[] \t\r\n")
                if clean_db:
                    try:
                        cur.execute(f"USE [{clean_db}];")
                    except Exception as db_exc:
                        logger.warning("Could not switch to database [%s]: %s", clean_db, db_exc)

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
        clean_schema = schema.strip() if schema and schema.strip() else None
        clean_search = search.strip() if search and search.strip() else None
        sql = """
        SELECT 
            SCHEMA_NAME(schema_id) AS [schema], 
            name, 
            CASE WHEN type = 'P' THEN 'P' ELSE 'FN' END AS [type],
            type_desc AS [kind]
        FROM sys.objects
        WHERE type IN ('P', 'FN', 'IF', 'TF')
          AND ( ? IS NULL OR SCHEMA_NAME(schema_id) = ? )
          AND ( ? IS NULL OR name LIKE '%' + ? + '%' )
        ORDER BY SCHEMA_NAME(schema_id), name
        """
        p = (clean_schema, clean_schema, clean_search, clean_search)
        try:
            rows = self._execute_query(sql, p, database=database)
            return rows
        except Exception as exc:
            logger.warning("Failed to list SQL Server procedures and functions: %s", exc)
            return []

    def describe_routine(
        self,
        routine_name: str,
        schema: Optional[str] = None,
        database: Optional[str] = None,
    ) -> ResultShape:
        full_name = f"[{schema}].[{routine_name}]" if schema else routine_name

        # 1. Statically inspect parameters
        param_sql = """
        SELECT 
            p.name, 
            TYPE_NAME(p.user_type_id) AS [type], 
            p.is_output
        FROM sys.parameters p
        WHERE p.object_id = OBJECT_ID(?)
        ORDER BY p.parameter_id
        """
        input_params: List[Dict[str, Any]] = []
        output_params: List[Dict[str, Any]] = []

        try:
            param_rows = self._execute_query(param_sql, (full_name,), database=database)
            for r in param_rows:
                p_name = r.get("name", "").lstrip("@")
                p_type = r.get("type", "nvarchar")
                is_out = bool(r.get("is_output", False))
                info = {"name": p_name, "type": p_type}
                if is_out:
                    output_params.append(info)
                else:
                    input_params.append(info)
        except Exception as exc:
            logger.warning("Failed to query sys.parameters for %s: %s", full_name, exc)

        # 2. Try static analysis via dm_exec_describe_first_result_set_for_object
        result_sets: List[Dict[str, Any]] = []
        dmv_sql = """
        SELECT 
            name, 
            system_type_name AS [type], 
            column_ordinal
        FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(?), 0)
        WHERE is_hidden = 0
        ORDER BY column_ordinal
        """
        try:
            dmv_rows = self._execute_query(dmv_sql, (full_name,), database=database)
            if dmv_rows and any(r.get("name") for r in dmv_rows):
                cols = [{"name": r.get("name"), "type": r.get("type", "unknown")} for r in dmv_rows]
                result_sets.append({
                    "index": 0,
                    "name": "Table0",
                    "columns": cols,
                })
        except Exception as exc:
            logger.debug("dm_exec_describe_first_result_set failed for %s: %s", full_name, exc)

        # 3. If DMV returned nothing (e.g. temp tables or multiple result sets), parse DDL definition
        if not result_sets:
            ddl_sql = "SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(?)"
            try:
                ddl_rows = self._execute_query(ddl_sql, (full_name,), database=database)
                definition = None
                if ddl_rows and ddl_rows[0].get("definition"):
                    definition = ddl_rows[0]["definition"]
                else:
                    # Fallback to OBJECT_DEFINITION(OBJECT_ID(?))
                    fb_sql = "SELECT OBJECT_DEFINITION(OBJECT_ID(?)) AS [definition]"
                    fb_rows = self._execute_query(fb_sql, (full_name,), database=database)
                    if fb_rows and fb_rows[0].get("definition"):
                        definition = fb_rows[0]["definition"]

                if definition:
                    parsed_sets = parse_sql_server_selects(definition)
                    if parsed_sets:
                        result_sets = parsed_sets
            except Exception as exc:
                logger.warning("Failed to read sys.sql_modules definition for %s: %s", full_name, exc)

        return ResultShape(
            result_sets=result_sets,
            output_params=output_params,
            input_params=input_params,
        )
