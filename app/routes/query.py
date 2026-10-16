import logging
from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id
from app.utils.db_message import clean_db_message, parse_error_details
from app.utils.sql_safety import check_query_safety, detect_fatal_actions
from app.services.settings_store import _load_settings_file

logger = logging.getLogger(__name__)
query_bp = Blueprint("query", __name__)

@query_bp.post("/execute")
def execute():
    data = request.get_json(silent=True) or {}

    connection_id = data.get("connection_id")
    sql = data.get("sql", "")

    if not connection_id:
        return jsonify(success=False, error="connection_id is required"), 400

    if not sql.strip():
        return jsonify(success=False, error="SQL is empty"), 400

    limit = data.get("limit")
    if limit is not None:
        try:
            limit = int(limit)
        except (ValueError, TypeError):
            limit = None

    database = data.get("database")
    schema = data.get("schema")

    exec_kwargs = {
        "limit": limit,
        "database": database,
        "schema": schema,
    }
    if "mode" in data:
        exec_kwargs["mode"] = data.get("mode", "normal")
    if "debug_session_id" in data:
        exec_kwargs["debug_session_id"] = data.get("debug_session_id")
    if "traces" in data:
        exec_kwargs["traces"] = data.get("traces", [])
    if "parameters" in data:
        exec_kwargs["parameters"] = data.get("parameters")
    if "stop_on_error" in data:
        exec_kwargs["stop_on_error"] = bool(data.get("stop_on_error", True))

    try:
        connection = get_connection_manager().get(
            get_owner_session_id(),
            connection_id,
        )

        adapter_db_type = getattr(getattr(connection, "adapter", None), "db_type", "tsql")
        dialect_val = adapter_db_type if isinstance(adapter_db_type, str) else "tsql"
        confirmed = bool(data.get("confirmed", False))
        read_only_val = getattr(connection, "read_only", False) is True
        env_raw = getattr(connection, "environment", None)
        env_val = env_raw if isinstance(env_raw, str) else None

        safety = check_query_safety(
            sql=sql,
            read_only=read_only_val,
            environment=env_val,
            confirmed=confirmed,
            dialect=dialect_val
        )
        if not safety["allowed"]:
            return jsonify(
                success=False,
                needs_confirmation=safety["needs_confirmation"],
                error_code=safety["error_code"],
                error=safety["message"],
                message=safety["message"],
                classification=safety["classification"],
                query_type="PROD_SAFETY"
            ), 200

        # Backend SQL Protection (DELETE/UPDATE without WHERE, TRUNCATE)
        settings = _load_settings_file()
        sql_settings = settings.get("sql", {}) if isinstance(settings, dict) else {}
        sql_protection_val = sql_settings.get("sqlprotection", 1)
        is_sql_protection_enabled = bool(sql_protection_val not in (0, "0", False))

        if is_sql_protection_enabled and not confirmed:
            fatal_actions = detect_fatal_actions(sql, dialect=dialect_val)
            if fatal_actions:
                fatal_types = [a.get("type", "FATAL_ACTION") for a in fatal_actions]
                actions_summary = ", ".join(dict.fromkeys(fatal_types))
                return jsonify(
                    success=False,
                    needs_confirmation=True,
                    error_code="ERR_FATAL_ACTION_CONFIRMATION_REQUIRED",
                    error=f"Cảnh báo bảo vệ SQL: Phát hiện câu lệnh nguy hiểm [{actions_summary}]. Yêu cầu xác nhận trước khi thực thi.",
                    message=f"Cảnh báo bảo vệ SQL: Phát hiện câu lệnh nguy hiểm [{actions_summary}]. Yêu cầu xác nhận trước khi thực thi.",
                    fatal_actions=fatal_actions,
                    query_type="FATAL_ACTION"
                ), 200

        result = connection.query_service.execute(
            sql,
            **exec_kwargs
        )
        return jsonify(result)

    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        clean_err = clean_db_message(exc)
        err_detail = parse_error_details(sql, exc)
        return jsonify(
            success=False,
            error=clean_err,
            errors=[err_detail] if err_detail.get("clean_message") else [],
            messages=[f"Msg: {clean_err}"],
            results=[]
        ), 400


@query_bp.post("/parse-parameters")
def parse_parameters():
    data = request.get_json(silent=True) or {}
    sql = data.get("sql", "")
    dialect = data.get("dialect", "sqlserver")
    from app.utils.sql_params import get_query_parameters
    try:
        params = get_query_parameters(sql, dialect)
        return jsonify(success=True, parameters=params)
    except Exception as exc:
        return jsonify(success=False, error=str(exc), parameters=[]), 400


@query_bp.post("/cancel")
def cancel():
    data = request.get_json(silent=True) or {}
    connection_id = data.get("connection_id")
    if not connection_id:
        return jsonify(success=False, error="connection_id is required"), 400

    try:
        connection = get_connection_manager().get(
            get_owner_session_id(),
            connection_id,
        )
        ok = connection.query_service.cancel()
        return jsonify(success=True, cancelled=ok)
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@query_bp.post("/explain")
def explain():
    """Return an execution plan text for the given SQL.

    For SQL Server: uses SET SHOWPLAN_TEXT ON / OFF.
    For PostgreSQL: uses EXPLAIN.
    """
    data = request.get_json(silent=True) or {}

    connection_id = data.get("connection_id")
    sql = data.get("sql", "").strip()
    database = data.get("database")

    if not connection_id:
        return jsonify(success=False, error="connection_id is required"), 400
    if not sql:
        return jsonify(success=False, error="SQL is empty"), 400

    try:
        cm = get_connection_manager()
        session_id = get_owner_session_id()
        conn = cm.get(session_id, connection_id)  # returns ConnectionSession directly
        adapter = conn.adapter

        db_type = conn.config.get("type", "sqlserver")

        if db_type == "postgresql":
            plan_sql = f"EXPLAIN\n{sql}"
            result = adapter.execute(plan_sql, database=database)
            plan_text = "\n".join(
                str(row[0]) for row in result.get("rows", [])
            )
        else:
            # SQL Server: SHOWPLAN_TEXT requires autocommit and separate statements
            cursor = adapter.connection.cursor()
            try:
                import re
                if database and not re.match(r'^\s*USE\s+', sql, flags=re.IGNORECASE):
                    try:
                        clean_db = str(database).replace("]", "]]")
                        cursor.execute(f"USE [{clean_db}]")
                    except Exception:
                        pass

                cursor.execute("SET SHOWPLAN_TEXT ON")
                cursor.nextset()
                cursor.execute(sql)
                lines = []
                while True:
                    if cursor.description:
                        lines += [str(row[0]) for row in cursor.fetchall()]
                    if not cursor.nextset():
                        break
                plan_text = "\n".join(lines)
            finally:
                try:
                    cursor.execute("SET SHOWPLAN_TEXT OFF")
                    cursor.close()
                except Exception:
                    pass

        return jsonify(success=True, plan=plan_text or "(No plan returned)")

    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@query_bp.post("/syntax-check")
def syntax_check():
    """Validate SQL syntax without side-effects for SQL Server and PostgreSQL."""
    data = request.get_json(silent=True) or {}

    sql = data.get("sql", "")
    dialect = data.get("dialect", "sqlserver")
    connection_id = data.get("connection_id")
    database = data.get("database")
    schema = data.get("schema")
    is_debug = bool(data.get("is_debug", False))

    if not sql or not sql.strip():
        return jsonify(success=True, diagnostics=[])

    conn_session = None
    if connection_id:
        try:
            cm = get_connection_manager()
            session_id = get_owner_session_id()
            conn_session = cm.get(session_id, connection_id)
            if not dialect or dialect == "sqlserver":
                conn_db_type = conn_session.config.get("type", "sqlserver")
                if conn_db_type:
                    dialect = conn_db_type
        except Exception:
            # If connection is busy or invalid, validator will safely fallback to offline parser (Rule 21)
            conn_session = None

    cached_tables = data.get("cached_tables")

    # Phase 1: Check syntax.pipeline and shadow mode toggles (default: True for pipeline, False for shadow)
    use_pipeline = True
    shadow_mode = False
    try:
        from app.services.settings_store import load_settings
        settings = load_settings()
        if isinstance(settings, dict):
            syntax_cfg = settings.get("syntax", {})
            if isinstance(syntax_cfg, dict):
                use_pipeline = bool(syntax_cfg.get("pipeline", True))
                shadow_mode = bool(syntax_cfg.get("shadow", False))
    except Exception:
        pass

    try:
        if use_pipeline:
            from app.database.syntax.coordinator import validate_sql_pipeline
            diagnostics = validate_sql_pipeline(
                sql=sql,
                dialect=dialect,
                connection_session=conn_session,
                database=database,
                schema=schema,
                is_debug=is_debug,
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
                is_debug=is_debug,
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
                        is_debug=is_debug,
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
        return jsonify(success=True, diagnostics=diagnostics)
    except Exception as exc:
        return jsonify(success=False, error=str(exc), diagnostics=[]), 400

