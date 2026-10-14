# -*- coding: utf-8 -*-
"""
Query Execution API Mixin.
Handles query execution, progress events, query cancellation, query explanation,
syntax checking, query plan generation, and flow visualization.
"""
import contextlib
import json
import logging
import webview
from app.utils.sql_safety import check_query_safety

logger = logging.getLogger("luobtool.api.query")


class QueryApiMixin:
    def _get_connection(self, connection_id):
        """Cooperative resolution through MRO to ConnectionsApiMixin."""
        next_method = getattr(super(), "_get_connection", None)
        if callable(next_method):
            return next_method(connection_id)
        if hasattr(self, "cm") and self.cm:
            try:
                owner = getattr(self, "owner_session_id", "desktop_user")
                return self.cm.get(owner, connection_id)
            except Exception:
                return None
        return None

    def execute_query(self, connection_id, sql, limit=1000, database=None, schema=None, query_id=None, mode="normal", debug_session_id=None, traces=None, confirmed=False, parameters=None, stop_on_error=True):
        try:
            conn = self._get_connection(connection_id)

            adapter_db_type = getattr(getattr(conn, "adapter", None), "db_type", "tsql")
            dialect_val = adapter_db_type if isinstance(adapter_db_type, str) else "tsql"
            safety = check_query_safety(
                sql=sql,
                read_only=getattr(conn, "read_only", False),
                environment=getattr(conn, "environment", None),
                confirmed=confirmed,
                dialect=dialect_val
            )
            if not safety["allowed"]:
                return {
                    "success": False,
                    "needs_confirmation": safety["needs_confirmation"],
                    "error_code": safety["error_code"],
                    "error": safety["message"],
                    "classification": safety["classification"]
                }

            def on_progress(event):
                if not query_id:
                    return
                try:
                    import webview, json
                    payload = json.dumps({"query_id": query_id, **event})
                    js = f"if (window.onQueryProgress) {{ window.onQueryProgress({payload}); }}"
                    for w in getattr(webview, 'windows', []):
                        try:
                            w.evaluate_js(js)
                        except Exception:
                            pass
                except Exception:
                    pass

            result = conn.query_service.execute(
                sql,
                limit=limit,
                database=database,
                schema=schema,
                progress_callback=on_progress if query_id else None,
                mode=mode,
                debug_session_id=debug_session_id,
                traces=traces,
                parameters=parameters,
                stop_on_error=stop_on_error,
            )
            return {"success": True, **result}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def parse_query_parameters(self, sql, dialect="sqlserver"):
        try:
            from app.utils.sql_params import get_query_parameters
            return {"success": True, "parameters": get_query_parameters(sql, dialect)}
        except Exception as exc:
            return {"success": False, "error": str(exc), "parameters": []}


    def cancel_query(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            if conn and hasattr(conn, "query_service"):
                ok = conn.query_service.cancel()
                return {"success": True, "cancelled": ok}
            return {"success": False, "error": "Connection not found"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def explain_query(self, connection_id, sql, database=None):
        try:
            conn = self._get_connection(connection_id)
            adapter = conn.adapter
            db_type = getattr(adapter, "db_type", "sqlserver").lower()

            if db_type == "postgresql":
                exp_sql = f"EXPLAIN (FORMAT TEXT) {sql}"
                result = conn.query_service.execute(exp_sql, limit=500, database=database)
                rows = result.get("rows", [])
                plan_text = "\n".join(str(r[0]) for r in rows if r)
            else:
                import contextlib
                lock = getattr(conn, "lock", None) or getattr(adapter, "_lock", None)
                lock_ctx = lock if lock is not None else contextlib.nullcontext()
                with lock_ctx:
                    cursor = adapter.get_cursor(database=database) if hasattr(adapter, "get_cursor") else adapter.connection.cursor()
                    try:
                        cursor.execute("SET SHOWPLAN_TEXT ON")
                        cursor.execute(sql)
                        rows = cursor.fetchall()
                        plan_text = "\n".join(str(r[0]) for r in rows if r)
                    finally:
                        try:
                            cursor.execute("SET SHOWPLAN_TEXT OFF")
                        except Exception:
                            pass
                        try:
                            cursor.close()
                        except Exception:
                            pass

            return {"success": True, "plan": plan_text}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def syntax_check(self, connection_id=None, sql="", dialect="sqlserver", database=None, schema=None, is_debug=False, cached_tables=None):
        try:
            if not sql or not str(sql).strip():
                return {"success": True, "diagnostics": []}

            conn_session = None
            try:
                conn_session = self._get_connection(connection_id)
                if conn_session:
                    if not dialect or dialect == "sqlserver":
                        conn_db_type = getattr(conn_session, "config", {}).get("type", "sqlserver")
                        if conn_db_type:
                            dialect = conn_db_type
                    if not database:
                        database = getattr(conn_session, "config", {}).get("database")
            except Exception:
                conn_session = None

            try:
                from app.database.syntax.coordinator import validate_sql_pipeline
                diagnostics = validate_sql_pipeline(
                    sql=sql,
                    dialect=dialect,
                    connection_session=conn_session,
                    database=database,
                    schema=schema,
                    is_debug=bool(is_debug),
                    cached_tables_dict=cached_tables,
                )
            except Exception as pipe_err:
                from app.database.syntax.validator import validate_sql
                diagnostics = validate_sql(
                    sql=sql,
                    dialect=dialect,
                    connection_session=conn_session,
                    database=database,
                    schema=schema,
                    is_debug=bool(is_debug),
                    cached_tables_dict=cached_tables,
                )
            return {"success": True, "diagnostics": diagnostics}
        except Exception as exc:
            return {"success": False, "error": str(exc), "diagnostics": []}


    def analyze_query_flow(self, sql, dialect="tsql"):
        try:
            from app.services.query_flow_service import QueryFlowService
            graph = QueryFlowService.build_flow_graph(sql, dialect=dialect)
            return {"success": True, "flowGraph": graph.to_dict()}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_query_plan(self, sql, conn_id=None, plan_type="estimated", database=None, schema=None, dialect=None):
        try:
            from app.services.query_plan_service import QueryPlanService
            conn_session = None
            if conn_id and hasattr(self, "_connection_manager") and self._connection_manager:
                try:
                    conn_session = self._connection_manager.get_connection(conn_id)
                except Exception:
                    pass

            plan = QueryPlanService.get_execution_plan(
                connection_session=conn_session,
                sql=sql,
                plan_type=plan_type,
                database=database,
                schema=schema,
                dialect=dialect,
            )
            return {"success": True, "plan": plan.to_dict()}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

