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
from app.utils.sql_safety import check_query_safety, detect_fatal_actions
from app.services.settings_store import _load_settings_file

logger = logging.getLogger("luobtool.api.query")


def _get_settings_loader():
    import sys
    main_mod = sys.modules.get("main")
    if main_mod and hasattr(main_mod, "_load_settings_file"):
        return main_mod._load_settings_file
    return _load_settings_file


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
            read_only_val = getattr(conn, "read_only", False) is True
            env_raw = getattr(conn, "environment", None)
            env_val = env_raw if isinstance(env_raw, str) else None
            safety = check_query_safety(
                sql=sql,
                read_only=read_only_val,
                environment=env_val,
                confirmed=confirmed,
                dialect=dialect_val
            )
            if not safety["allowed"]:
                return {
                    "success": False,
                    "needs_confirmation": safety["needs_confirmation"],
                    "error_code": safety["error_code"],
                    "error": safety["message"],
                    "message": safety["message"],
                    "classification": safety["classification"],
                    "query_type": "PROD_SAFETY"
                }

            # Backend SQL Protection (DELETE/UPDATE without WHERE, TRUNCATE)
            loader = _get_settings_loader()
            settings = loader() if callable(loader) else {}
            sql_settings = settings.get("sql", {}) if isinstance(settings, dict) else {}
            sql_protection_val = sql_settings.get("sqlprotection", 1)
            is_sql_protection_enabled = bool(sql_protection_val not in (0, "0", False))

            if is_sql_protection_enabled and not confirmed:
                fatal_actions = detect_fatal_actions(sql, dialect=dialect_val)
                if fatal_actions:
                    fatal_types = [a.get("type", "FATAL_ACTION") for a in fatal_actions]
                    actions_summary = ", ".join(dict.fromkeys(fatal_types))
                    return {
                        "success": False,
                        "needs_confirmation": True,
                        "error_code": "ERR_FATAL_ACTION_CONFIRMATION_REQUIRED",
                        "error": f"Cảnh báo bảo vệ SQL: Phát hiện câu lệnh nguy hiểm [{actions_summary}]. Yêu cầu xác nhận trước khi thực thi.",
                        "message": f"Cảnh báo bảo vệ SQL: Phát hiện câu lệnh nguy hiểm [{actions_summary}]. Yêu cầu xác nhận trước khi thực thi.",
                        "fatal_actions": fatal_actions,
                        "query_type": "FATAL_ACTION"
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
            if isinstance(result, dict) and result.get("success", True):
                try:
                    from app.database.syntax.semantic_analyzer import invalidate_on_ddl
                    invalidate_on_ddl(sql, connection_id=connection_id, database=database)
                except Exception as ddl_err:
                    logger.debug("[QueryApi] invalidate_on_ddl failed: %s", ddl_err)
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

            # Phase 5 / Phase 7: Check syntax.pipeline and shadow mode toggles (default: False for pipeline, True for shadow)
            use_pipeline = False
            shadow_mode = True
            try:
                from app.services.settings_store import load_settings
                settings = load_settings()
                if isinstance(settings, dict):
                    syntax_cfg = settings.get("syntax", {})
                    if isinstance(syntax_cfg, dict):
                        use_pipeline = bool(syntax_cfg.get("pipeline", False))
                        shadow_mode = bool(syntax_cfg.get("shadow", True))
            except Exception:
                pass

            if use_pipeline:
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
                    logger.warning("[SyntaxCheck] validate_sql_pipeline error, falling back to legacy: %s", pipe_err)
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
            else:
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
                if shadow_mode:
                    try:
                        from app.database.syntax.coordinator import validate_sql_pipeline
                        shadow_diags = validate_sql_pipeline(
                            sql=sql,
                            dialect=dialect,
                            connection_session=conn_session,
                            database=database,
                            schema=schema,
                            is_debug=bool(is_debug),
                            cached_tables_dict=cached_tables,
                        )
                        legacy_keys = {(d.get("line"), d.get("column"), str(d.get("message") or d.get("msg") or "").strip()) for d in (diagnostics or [])}
                        shadow_keys = {(d.get("line"), d.get("column"), str(d.get("message") or d.get("msg") or "").strip()) for d in (shadow_diags or [])}
                        if legacy_keys != shadow_keys:
                            logger.info(
                                "[SyntaxCheck Shadow] Divergence detected (legacy=%d, shadow=%d). Legacy: %s | Shadow: %s",
                                len(diagnostics or []),
                                len(shadow_diags or []),
                                diagnostics,
                                shadow_diags,
                            )
                    except Exception as shadow_err:
                        logger.debug("[SyntaxCheck Shadow] Error executing shadow pipeline: %s", shadow_err)
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

    def invalidate_metadata_cache(self, connection_id=None, database=None, schema=None, table_name=None):
        try:
            from app.database.syntax.semantic_analyzer import invalidate_physical_table_columns_cache
            count = invalidate_physical_table_columns_cache(connection_id, database, schema, table_name)
            return {"success": True, "invalidated": count}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

