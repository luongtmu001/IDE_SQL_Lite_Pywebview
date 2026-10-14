import time
from app.database.base import DatabaseAdapter
from app.utils.db_message import clean_db_message, parse_error_details
from app.utils.sql_splitter import split_statements

try:
    import psycopg
    _PSYCOPG_MODULE = psycopg
    _IS_PSYCOPG3 = True
except ImportError:
    try:
        import psycopg2 as psycopg
        _PSYCOPG_MODULE = psycopg
        _IS_PSYCOPG3 = False
    except ImportError:
        _PSYCOPG_MODULE = None
        _IS_PSYCOPG3 = False

def serialize_cell(val):
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, (bytes, bytearray, memoryview)):
        return "0x" + bytes(val).hex()
    if isinstance(val, (dict, list)):
        import json
        return json.dumps(val, ensure_ascii=False, default=str)
    return str(val)

class PostgreSqlAdapter(DatabaseAdapter):
    db_type = "postgresql"

    def connect(self):
        if _PSYCOPG_MODULE is None:
            raise RuntimeError("Neither psycopg (v3) nor psycopg2 is installed")

        conn_params = self._build_conn_params()
        self.connection = _PSYCOPG_MODULE.connect(**conn_params)
        self.connection.autocommit = True
        self._current_search_path = None

    def _build_conn_params(self):
        c = self.config
        params = {
            "host": c.get("host") or c.get("server") or "localhost",
            "port": int(c.get("port") or 5432),
            "dbname": c.get("database") or c.get("dbname") or "postgres",
            "user": c.get("username") or c.get("user") or "postgres",
            "password": str(c.get("password") or ""),
            "connect_timeout": int(c.get("timeout") or c.get("connect_timeout") or 10),
            "application_name": c.get("application_name") or "luoBTool",
        }
        sslmode = c.get("sslmode") or c.get("ssl_mode")
        if sslmode:
            params["sslmode"] = sslmode
        return params

    def _ensure_database(self, database):
        if not database:
            return
        target_db = database.strip()
        cur_db = (self.config.get("database") or "postgres").strip()
        if target_db.lower() != cur_db.lower():
            self.config["database"] = target_db
            # Synchronize session config if attached to avoid out-of-sync state
            session = getattr(self, "session", None) or getattr(self, "connection_session", None)
            if session and hasattr(session, "config") and isinstance(session.config, dict):
                session.config["database"] = target_db
            if self.connection:
                try:
                    self.connection.close()
                except Exception:
                    pass
                self.connection = None
                self._current_search_path = None
            self.connect()

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None
            self._current_search_path = None

    def cancel(self):
        self._is_cancelled = True
        if self.connection:
            try:
                if hasattr(self.connection, "cancel_safe"):
                    self.connection.cancel_safe()
                elif hasattr(self.connection, "cancel"):
                    self.connection.cancel()
                return True
            except Exception:
                pass
        return False

    def execute(self, sql, params=None, limit=None, database=None, schema=None, **kwargs):
        if sql and "#" in sql:
            import re
            if re.search(r"(?:^|[^a-zA-Z0-9_\$])#[a-zA-Z_]", sql):
                from app.database.debug.instrumenter import transform_pg_temp_tables
                sql = transform_pg_temp_tables(sql)
        if database:
            self._ensure_database(database)
        if not self.connection or getattr(self.connection, "closed", False):
            self.connect()
        self._is_cancelled = False
        progress_callback = kwargs.get("progress_callback")
        results = []
        messages = []
        errors = []
        statements = []
        total_affected = 0
        seen_notices = set()
        stop_on_error = kwargs.get("stop_on_error", True)

        def notice_callback(diag):
            raw = getattr(diag, 'message_primary', None) or str(diag)
            cleaned = clean_db_message(raw)
            if cleaned and cleaned not in seen_notices:
                seen_notices.add(cleaned)
                messages.append(cleaned)

        has_handler = hasattr(self.connection, 'add_notice_handler')
        if has_handler:
            try:
                self.connection.add_notice_handler(notice_callback)
            except Exception:
                has_handler = False

        try:
            with self.connection.cursor() as cursor:
                # Set search_path strictly to target_schema so objects outside this schema are not resolved
                target_schema = (schema or self.config.get("schema") or "").strip()
                if target_schema:
                    safe_schema = target_schema.replace('"', '""')
                    schemas_to_set = [f'"{safe_schema}"']
                else:
                    schemas_to_set = ['public']

                cur_path = getattr(self, "_current_search_path", None)
                if cur_path != schemas_to_set:
                    set_path_sql = f'SET search_path TO {", ".join(schemas_to_set)}'
                    try:
                        cursor.execute(set_path_sql)
                        self._current_search_path = schemas_to_set
                    except Exception:
                        pass

                statements_meta = split_statements(sql, dialect="postgresql")
                if not statements_meta:
                    statements_meta = [{"sql": sql, "start_line": 1, "end_line": 1}]

                for s_info in statements_meta:
                    if self._is_cancelled:
                        break
                    stmt_sql = s_info["sql"]
                    stmt_start = s_info.get("start_line", 1)
                    t_s0 = time.perf_counter()
                    stmt_start_res_len = len(results)
                    stmt_error_str = None
                    stmt_affected_start = total_affected

                    try:
                        if params:
                            cursor.execute(stmt_sql, params)
                        else:
                            cursor.execute(stmt_sql)

                        while True:
                            if self._is_cancelled:
                                break
                            if cursor.description:
                                columns = [desc.name for desc in cursor.description]
                                fetch_limit = limit if limit is not None else int(self.config.get("max_rows", 1000))
                                res_index = len(results)

                                if progress_callback:
                                    try:
                                        progress_callback({
                                            "type": "columns",
                                            "result_index": res_index,
                                            "columns": columns,
                                        })
                                    except Exception:
                                        pass

                                    row_count = 0
                                    first_chunk = True
                                    while True:
                                        if self._is_cancelled:
                                            break
                                        chunk_size = 100 if first_chunk else 500
                                        first_chunk = False
                                        if fetch_limit > 0:
                                            remaining = fetch_limit - row_count
                                            if remaining <= 0:
                                                break
                                            chunk_size = min(chunk_size, remaining)

                                        raw_rows = cursor.fetchmany(chunk_size)
                                        if not raw_rows:
                                            break
                                        serialized_chunk = [[serialize_cell(c) for c in r] for r in raw_rows]
                                        row_count += len(serialized_chunk)

                                        try:
                                            progress_callback({
                                                "type": "chunk",
                                                "result_index": res_index,
                                                "columns": columns,
                                                "rows": serialized_chunk,
                                                "total_so_far": row_count,
                                            })
                                        except Exception:
                                            pass

                                    results.append({
                                        "columns": columns,
                                        "rows": [],
                                        "row_count": row_count,
                                        "streamed": True
                                    })
                                else:
                                    if fetch_limit == 0:
                                        raw_rows = cursor.fetchall()
                                    else:
                                        raw_rows = cursor.fetchmany(fetch_limit)
                                    rows = [[serialize_cell(c) for c in r] for r in (raw_rows or []) if r is not None]
                                    row_count = len(rows)
                                    results.append({
                                        "columns": columns,
                                        "rows": rows,
                                        "row_count": row_count
                                    })
                                messages.append(f"({row_count} row(s) returned)")
                            else:
                                rc = cursor.rowcount
                                if rc != -1 and rc is not None:
                                    messages.append(f"({rc} row(s) affected)")
                                    total_affected += rc

                            try:
                                if not cursor.nextset():
                                    break
                            except Exception:
                                break

                    except Exception as pg_err:
                        is_cancel = self._is_cancelled or "cancel" in str(pg_err).lower()
                        if is_cancel:
                            messages.append("Query execution was cancelled by user.")
                        else:
                            err_detail = parse_error_details(sql, pg_err, batch_start_line=stmt_start)
                            if err_detail["clean_message"]:
                                errors.append(err_detail)
                                stmt_error_str = err_detail["clean_message"]
                                if err_detail.get("line"):
                                    messages.append(f"Msg: Line {err_detail['line']}: {err_detail['clean_message']}")
                                else:
                                    messages.append(f"Msg: {err_detail['clean_message']}")

                    s_ms = round((time.perf_counter() - t_s0) * 1000)
                    s_results = results[stmt_start_res_len:]
                    s_first_res = s_results[0] if s_results else {}
                    statements.append({
                        "index": len(statements) + 1,
                        "sql": stmt_sql,
                        "start_line": stmt_start,
                        "rows": s_first_res.get("rows", []),
                        "columns": s_first_res.get("columns", []),
                        "rows_affected": total_affected - stmt_affected_start,
                        "duration_ms": s_ms,
                        "error": stmt_error_str
                    })

                    if stop_on_error and stmt_error_str:
                        break

        finally:
            if has_handler:
                try:
                    self.connection.remove_notice_handler(notice_callback)
                except Exception:
                    pass

        first = results[0] if results else {"columns": [], "rows": [], "row_count": total_affected}
        success = len(errors) == 0

        return {
            "success": success,
            "columns": first["columns"],
            "rows": first["rows"],
            "row_count": first["row_count"],
            "results": results,
            "statements": statements,
            "messages": messages,
            "errors": errors,
            "cancelled": self._is_cancelled,
            "error": "\n".join(e["clean_message"] for e in errors) if errors else None,
            "message": "\n".join(messages) if messages else ("Commands completed successfully." if success else "\n".join(e["clean_message"] for e in errors)),
            "current_database": self.config.get("database", "postgres"),
        }

    def execute_debug(self, sql, params=None, limit=None, database=None, schema=None, debug_session_id=None, traces=None, **kwargs):
        """Execute SQL with PostgreSQL IDE Debug Extension instrumentation."""
        self._is_cancelled = False
        import re
        import time
        from app.database.debug.instrumenter import (
            instrument_sql_for_debug,
            get_setup_debug_sql,
            get_collect_debug_sql,
            process_collected_telemetry,
            strip_debug_injections_from_function,
            split_postgres_statements,
            is_return_statement,
            detect_debug_extensions,
        )

        all_trace_results = []
        ordered_results = []
        all_messages = []
        all_errors = []

        # Master trace definitions map across the whole session/script
        all_trace_defs_map = {}
        if traces:
            for t in traces:
                if t and t.get("sourceTraceId"):
                    all_trace_defs_map[t["sourceTraceId"]] = t

        all_script_traces = detect_debug_extensions(sql)
        for t in all_script_traces:
            if t and t.get("sourceTraceId"):
                all_trace_defs_map[t["sourceTraceId"]] = t

        # Detect any CREATE FUNCTION / PROCEDURE in SQL to support automatic restore
        func_def_regex = re.compile(
            r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:\"?([a-zA-Z0-9_]+)\"?\.)?\"?([a-zA-Z0-9_]+)\"?",
            re.IGNORECASE,
        )
        detected_funcs = []
        existing_defs = {}

        for m in func_def_regex.finditer(sql):
            sch_name = m.group(1) or schema or "dbo"
            fn_name = m.group(2)
            detected_funcs.append((fn_name, sch_name))

        if detected_funcs:
            if database:
                self._ensure_database(database)
            if not self.connection or getattr(self.connection, "closed", False):
                self.connect()
            for fn_name, sch_name in detected_funcs:
                try:
                    with self.connection.cursor() as cur:
                        cur.execute(
                            """
                            SELECT pg_get_functiondef(p.oid)
                            FROM pg_proc p
                            JOIN pg_namespace n ON p.pronamespace = n.oid
                            WHERE lower(p.proname) = lower(%s) AND lower(n.nspname) = lower(%s);
                            """,
                            (fn_name, sch_name),
                        )
                        row = cur.fetchone()
                        if row and row[0]:
                            existing_defs[(fn_name.lower(), sch_name.lower())] = row[0]
                except Exception:
                    pass

        try:
            # 1. Setup session-local trace queue
            self.execute(get_setup_debug_sql(), database=database, schema=schema)

            # 2. Split script into sequential statements
            statements = split_postgres_statements(sql)
            if not statements:
                statements = [{"text": sql}]

            runtime_order = 0
            order_counter = 0
            trace_id_counter = 1

            def collect_traces():
                nonlocal runtime_order, order_counter
                try:
                    collect_res = self.execute(get_collect_debug_sql(), database=database, schema=schema)
                    raw_rows = collect_res.get("rows", [])
                    if raw_rows:
                        trace_events = process_collected_telemetry(raw_rows, list(all_trace_defs_map.values()))
                        for tr in trace_events:
                            if not tr.get("columns"):
                                inner_sql = tr.get("source_location", {}).get("innerContent", "").strip()
                                clean_sql = re.sub(r";+\s*$", "", inner_sql).strip()
                                upper_sql = clean_sql.upper()
                                if upper_sql.startswith("SELECT") or upper_sql.startswith("WITH") or upper_sql.startswith("TABLE"):
                                    try:
                                        probe_res = self.execute(
                                            f"SELECT * FROM ({clean_sql}) _ide_col_probe WHERE false",
                                            database=database,
                                            schema=schema
                                        )
                                        if probe_res and probe_res.get("columns"):
                                            tr["columns"] = probe_res["columns"]
                                    except Exception:
                                        pass
                            if not tr.get("columns"):
                                tr["columns"] = ["result"]
                                if not tr.get("rows"):
                                    tr["rows"] = []

                            order_counter += 1
                            runtime_order += 1
                            tr["runtime_order"] = runtime_order
                            all_trace_results.append(tr)
                            ordered_results.append({
                                "columns": tr.get("columns", []),
                                "rows": tr.get("rows", []),
                                "row_count": tr.get("row_count", 0),
                                "isTrace": True,
                                "traceId": tr.get("trace_id"),
                                "runtimeOrder": runtime_order,
                                "iteration": tr.get("iteration", 1),
                                "sourceLocation": tr.get("source_location"),
                                "title": f"Trace #{runtime_order}: {tr.get('trace_id')}" + (f" (Iteration {tr['iteration']})" if tr.get("iteration", 1) > 1 else ""),
                                "order": order_counter,
                            })
                except Exception:
                    pass

            # 3. Sequentially execute each statement in order
            for stmt_info in statements:
                raw_stmt = stmt_info.get("text", "").strip()
                if not raw_stmt:
                    continue
                stmt_line_offset = max(0, stmt_info.get("start_line", 1) - 1)

                # Requirement 2: Check for RETURN keyword - skip all code below it like normal postgres!
                if is_return_statement(raw_stmt):
                    collect_traces()
                    clean = re.sub(r"--[^\n]*", "", raw_stmt)
                    clean = re.sub(r"/\*.*?\*/", "", clean, flags=re.DOTALL).strip().rstrip(";").strip()
                    m_ret = re.match(r"^RETURN(?:\s+QUERY)?\s+(.+)$", clean, re.IGNORECASE)
                    if m_ret:
                        ret_expr = m_ret.group(1).strip()
                        if ret_expr:
                            if ret_expr.upper().startswith("SELECT") or ret_expr.upper().startswith("WITH") or ret_expr.upper().startswith("TABLE"):
                                eval_sql = ret_expr
                            else:
                                eval_sql = f"SELECT ({ret_expr}) AS return_value"
                            try:
                                ret_res = self.execute(eval_sql, params=params, limit=limit, database=database, schema=schema, **kwargs)
                                if ret_res.get("results"):
                                    for r in ret_res["results"]:
                                        if r.get("columns"):
                                            order_counter += 1
                                            ordered_results.append({
                                                "columns": r.get("columns", []),
                                                "rows": r.get("rows", []),
                                                "row_count": r.get("row_count", 0),
                                                "isTrace": False,
                                                "title": "Return Value",
                                                "order": order_counter,
                                            })
                            except Exception:
                                pass
                    all_messages.append("(Execution stopped at RETURN: remaining code below was skipped)")
                    break

                # Check if statement contains bs.* calls
                stmt_traces = detect_debug_extensions(raw_stmt, start_order=trace_id_counter, line_offset=stmt_line_offset)
                if stmt_traces:
                    inst_stmt, traces_def = instrument_sql_for_debug(
                        raw_stmt,
                        stmt_traces,
                        start_order=trace_id_counter,
                        line_offset=stmt_line_offset
                    )
                    trace_id_counter += len(traces_def)
                    for t in traces_def:
                        if t and t.get("sourceTraceId"):
                            all_trace_defs_map[t["sourceTraceId"]] = t

                    res = self.execute(
                        inst_stmt,
                        params=params,
                        limit=limit,
                        database=database,
                        schema=schema,
                        **kwargs
                    )
                    if res.get("messages"):
                        all_messages.extend(res["messages"])
                    if res.get("errors"):
                        all_errors.extend(res["errors"])
                        collect_traces()
                        if not res.get("success", True):
                            break

                    # Collect trace telemetry immediately for this statement
                    collect_traces()

                    # Also include any standard results from this statement if any
                    if res.get("results"):
                        for r in res["results"]:
                            if r.get("columns") and r.get("columns") != ["trace_id", "payload_json", "logged_at"]:
                                order_counter += 1
                                ordered_results.append({
                                    "columns": r.get("columns", []),
                                    "rows": r.get("rows", []),
                                    "row_count": r.get("row_count", 0),
                                    "isTrace": False,
                                    "title": f"Result #{order_counter}",
                                    "order": order_counter,
                                })
                else:
                    # Regular query without bs.* (e.g. function call SELECT ufn_test(), procedure CALL usp_test())
                    res = self.execute(
                        raw_stmt,
                        params=params,
                        limit=limit,
                        database=database,
                        schema=schema,
                        **kwargs
                    )
                    if res.get("messages"):
                        all_messages.extend(res["messages"])
                    if res.get("errors"):
                        all_errors.extend(res["errors"])
                        collect_traces()
                        if not res.get("success", True):
                            break

                    # Collect trace telemetry emitted by functions/procedures invoked by this query
                    collect_traces()

                    if res.get("results"):
                        for r in res["results"]:
                            if r.get("columns"):
                                order_counter += 1
                                ordered_results.append({
                                    "columns": r.get("columns", []),
                                    "rows": r.get("rows", []),
                                    "row_count": r.get("row_count", 0),
                                    "isTrace": False,
                                    "title": f"Result #{order_counter}",
                                    "order": order_counter,
                                })
            first = ordered_results[0] if ordered_results else {"columns": [], "rows": [], "row_count": 0}
            success = len(all_errors) == 0

            return {
                "success": success,
                "mode": "debug",
                "debug_session_id": debug_session_id or f"DBG_{int(time.time())}",
                "columns": first.get("columns", []),
                "rows": first.get("rows", []),
                "row_count": first.get("row_count", 0),
                "results": ordered_results,
                "trace_results": all_trace_results,
                "messages": all_messages if all_messages else ["Debug execution completed successfully."],
                "errors": all_errors,
                "cancelled": getattr(self, "_is_cancelled", False),
                "error": "\n".join(e.get("clean_message", str(e)) for e in all_errors) if all_errors else None,
                "message": "\n".join(all_messages) if all_messages else ("Debug execution completed successfully." if success else "\n".join(e.get("clean_message", str(e)) for e in all_errors)),
                "current_database": self.config.get("database", "postgres"),
            }

        except Exception as exc:
            return {
                "success": False,
                "mode": "debug",
                "debug_session_id": debug_session_id,
                "columns": [],
                "rows": [],
                "row_count": 0,
                "results": [],
                "trace_results": all_trace_results,
                "messages": [f"Debug execution error: {str(exc)}"],
                "errors": [{"clean_message": str(exc), "line": 1, "col": 1}],
                "cancelled": getattr(self, "_is_cancelled", False),
                "error": str(exc),
                "message": str(exc),
                "current_database": self.config.get("database", "postgres"),
            }

        finally:
            # Automatically restore original clean code for any debugged function/procedure
            if detected_funcs:
                for fn_name, sch_name in detected_funcs:
                    key = (fn_name.lower(), sch_name.lower())
                    orig_code = existing_defs.get(key)
                    restore_sql = None
                    if orig_code:
                        restore_sql = orig_code
                    else:
                        try:
                            with self.connection.cursor() as cur:
                                cur.execute(
                                    """
                                    SELECT pg_get_functiondef(p.oid)
                                    FROM pg_proc p
                                    JOIN pg_namespace n ON p.pronamespace = n.oid
                                    WHERE lower(p.proname) = lower(%s) AND lower(n.nspname) = lower(%s);
                                    """,
                                    (fn_name, sch_name),
                                )
                                row = cur.fetchone()
                                current_def = row[0] if row else None
                        except Exception:
                            current_def = None
                        if current_def:
                            restore_sql = strip_debug_injections_from_function(current_def)

                    if restore_sql:
                        try:
                            self.execute(restore_sql, database=database, schema=schema)
                        except Exception:
                            pass

    def list_databases(self):
        result = self.execute(
            """
            SELECT datname, datallowconn
            FROM pg_database
            WHERE datistemplate = false
            ORDER BY datname
            """,
            limit=0,
        )

        return [
            {
                "name": row[0],
                "allow_connection": row[1],
            }
            for row in result["rows"]
        ]

    def list_schemas(self, database=None):
        result = self.execute(
            """
            SELECT nspname
            FROM pg_catalog.pg_namespace
            WHERE nspname NOT LIKE 'pg_toast%%'
              AND nspname NOT LIKE 'pg_temp%%'
            ORDER BY nspname
            """,
            limit=0,
            database=database
        )

        return [{"name": row[0]} for row in result["rows"]]

    def list_objects(self, database, schema, object_type, search=None, limit=0):
        target_schema = (schema or "public").strip()

        if object_type in ["procedures", "functions"]:
            sql = """
                SELECT n.nspname,
                       p.proname,
                       p.oid,
                       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
                       p.pronargs
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
            """
            if object_type == "procedures":
                sql += "  AND p.prokind = 'p'"
            else:
                sql += "  AND p.prokind != 'p'"
            params = [target_schema, target_schema]
            if search:
                sql += "  AND p.proname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY p.proname, p.pronargs"

        elif object_type in ["materialized_views", "mviews", "materialized_view"]:
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind = 'm'
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type == "views":
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind = 'v'
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type == "tables":
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind IN ('r', 'p')
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type == "triggers":
            sql = """
                SELECT n.nspname, t.tgname, t.oid
                FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND NOT t.tgisinternal
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND t.tgname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY t.tgname"

        elif object_type == "sequences":
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind = 'S'
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type in ("user_types", "types"):
            sql = """
                SELECT n.nspname, t.typname, t.oid
                FROM pg_catalog.pg_type t
                JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND t.typtype IN ('c', 'd', 'e')
                  AND NOT EXISTS (
                      SELECT 1 FROM pg_catalog.pg_class c
                      WHERE c.oid = t.typrelid AND c.relkind != 'c'
                  )
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND t.typname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY t.typname"

        else:
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        result = self.execute(sql, tuple(params), limit=limit, database=database)

        if object_type in ["procedures", "functions"]:
            items = []
            for row in result["rows"]:
                schema_name = row[0]
                proc_name = row[1]
                oid = row[2] if len(row) > 2 else None
                identity_args = row[3] if len(row) > 3 and row[3] is not None else ""
                full_sig = f"{proc_name}({identity_args})"
                items.append({
                    "schema": schema_name,
                    "name": full_sig,
                    "base_name": proc_name,
                    "identity_args": identity_args,
                    "id": oid,
                    "oid": oid,
                })
            return items

        return [
            {
                "schema": row[0],
                "name": row[1],
                "id": row[2] if len(row) > 2 else None,
            }
            for row in result["rows"]
        ]

    def get_object_definition(
        self,
        database,
        schema,
        name,
        object_type,
    ):
        target_schema = schema or "public"
        norm_type = (object_type or "").lower().rstrip("s")

        if norm_type in {"function", "procedure", "routine"}:
            pure_name = name
            identity_args = ""
            if "(" in name and name.endswith(")"):
                parts = name.split("(", 1)
                pure_name = parts[0].strip()
                identity_args = parts[1].rstrip(")").strip()

            sql = """
                SELECT pg_catalog.pg_get_functiondef(p.oid)
                FROM pg_catalog.pg_proc AS p
                JOIN pg_catalog.pg_namespace AS n
                  ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (p.proname = %s OR lower(p.proname) = lower(%s))
            """
            params = [target_schema, target_schema, pure_name, pure_name]
            if identity_args:
                sql += """
                  AND (
                      pg_catalog.pg_get_function_identity_arguments(p.oid) = %s
                      OR lower(pg_catalog.pg_get_function_identity_arguments(p.oid)) = lower(%s)
                  )
                """
                params.extend([identity_args, identity_args])
            sql += "\n                ORDER BY p.pronargs ASC\n                LIMIT 1"

            result = self.execute(
                sql,
                tuple(params),
                limit=1,
                database=database
            )
            return result["rows"][0][0] if result.get("rows") else None

        if norm_type in {"view", "materialized_view", "mview"}:
            result = self.execute(
                """
                SELECT 
                    CASE WHEN c.relkind = 'm' THEN 'CREATE MATERIALIZED VIEW ' ELSE 'CREATE OR REPLACE VIEW ' END ||
                    quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' AS' || E'\\n' ||
                    pg_catalog.pg_get_viewdef(c.oid, true)
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind IN ('v', 'm')
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            if result.get("rows") and result["rows"][0][0]:
                return result["rows"][0][0]

            # Fallback matching by object name across schemas
            res_fb = self.execute(
                """
                SELECT 
                    CASE WHEN c.relkind = 'm' THEN 'CREATE MATERIALIZED VIEW ' ELSE 'CREATE OR REPLACE VIEW ' END ||
                    quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' AS' || E'\\n' ||
                    pg_catalog.pg_get_viewdef(c.oid, true)
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind IN ('v', 'm')
                LIMIT 1
                """,
                (name, name),
                limit=1,
                database=database
            )
            return res_fb["rows"][0][0] if res_fb.get("rows") else None

        if norm_type == "trigger":
            result = self.execute(
                """
                SELECT pg_catalog.pg_get_triggerdef(t.oid, true) || ';'
                FROM pg_catalog.pg_trigger AS t
                JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
                WHERE n.nspname = %s
                  AND (t.tgname = %s OR lower(t.tgname) = lower(%s))
                  AND NOT t.tgisinternal
                LIMIT 1
                """,
                (target_schema, name, name),
                limit=1,
                database=database
            )
            return result["rows"][0][0] if result.get("rows") else None

        if norm_type in {"sequence", "sequences"}:
            result = self.execute(
                """
                SELECT 
                    'CREATE SEQUENCE ' || quote_ident(schemaname) || '.' || quote_ident(sequencename) || E'\\n' ||
                    '    START WITH ' || start_value || E'\\n' ||
                    '    INCREMENT BY ' || increment_by || E'\\n' ||
                    '    MINVALUE ' || min_value || E'\\n' ||
                    '    MAXVALUE ' || max_value || E'\\n' ||
                    CASE WHEN cycle THEN '    CYCLE;' ELSE '    NO CYCLE;' END
                FROM pg_catalog.pg_sequences
                WHERE (schemaname = %s OR lower(schemaname) = lower(%s))
                  AND (sequencename = %s OR lower(sequencename) = lower(%s))
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            if result.get("rows"):
                return result["rows"][0][0]

            result_fallback = self.execute(
                """
                SELECT 
                    '-- Sequence: ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || E'\\n' ||
                    'CREATE SEQUENCE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ';'
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind = 'S'
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            return result_fallback["rows"][0][0] if result_fallback.get("rows") else None

        if norm_type in {"user_type", "user_types", "type", "types"}:
            result = self.execute(
                """
                SELECT 
                    CASE t.typtype
                        WHEN 'e' THEN
                            'CREATE TYPE ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || ' AS ENUM (' ||
                            COALESCE((
                                SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder)
                                FROM pg_catalog.pg_enum WHERE enumtypid = t.oid
                            ), '') || ');'
                        WHEN 'd' THEN
                            'CREATE DOMAIN ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || ' AS ' ||
                            format_type(t.typbasetype, t.typtypmod) || ';'
                        ELSE
                            '-- Type: ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || E'\\n' ||
                            '-- Kind: ' || t.typtype
                    END
                FROM pg_catalog.pg_type t
                JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (t.typname = %s OR lower(t.typname) = lower(%s))
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            return result["rows"][0][0] if result.get("rows") else None

        return None

    def get_intellisense_objects(self, database=None, schema=None):
        target_schema = (schema or "public").strip()
        items = []
        try:
            # 1. Tables, Views, Materialized Views from pg_class
            tv_query = """
                SELECT c.relname, n.nspname,
                       CASE c.relkind
                           WHEN 'r' THEN 'table'
                           WHEN 'p' THEN 'table'
                           WHEN 'v' THEN 'view'
                           WHEN 'm' THEN 'materialized_view'
                           WHEN 'f' THEN 'foreign_table'
                           ELSE 'table'
                       END AS obj_type
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                ORDER BY c.relname
            """
            res = self.execute(tv_query, [target_schema, target_schema], limit=0, database=database)
            for row in res.get("rows", []):
                items.append({
                    "name": row[0],
                    "schema": row[1],
                    "type": row[2],
                    "target_object": ""
                })

            # 2. Routines (Procedures / Functions from pg_proc)
            routines_query = """
                SELECT 
                    p.proname AS routine_name, 
                    n.nspname AS routine_schema, 
                    CASE 
                        WHEN p.prokind = 'p' THEN 'procedure'
                        ELSE 'function'
                    END AS routine_type
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                ORDER BY p.proname
            """
            res_r = self.execute(routines_query, [target_schema, target_schema], limit=0, database=database)
            for row in res_r.get("rows", []):
                name, s_name, r_type = row[0], row[1], (row[2] or "").lower()
                items.append({
                    "name": name,
                    "schema": s_name,
                    "type": r_type if r_type in ["procedure", "function"] else "function",
                    "target_object": ""
                })

            # 3. Triggers from pg_trigger
            try:
                triggers_query = """
                    SELECT t.tgname, n.nspname
                    FROM pg_catalog.pg_trigger t
                    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                      AND NOT t.tgisinternal
                    ORDER BY t.tgname
                """
                res_t = self.execute(triggers_query, [target_schema, target_schema], limit=0, database=database)
                for row in res_t.get("rows", []):
                    name, s_name = row[0], row[1]
                    items.append({
                        "name": name,
                        "schema": s_name,
                        "type": "trigger",
                        "target_object": ""
                    })
            except Exception:
                pass

            return items
        except Exception:
            return []

    def get_intellisense_columns(self, database=None, schema=None, table_name=None):
        if not table_name:
            return []
        target_schema = (schema or "public").strip()
        query = """
            SELECT 
                a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS is_nullable,
                CASE WHEN pk.attnum IS NOT NULL THEN 1 ELSE 0 END AS is_pk
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN (
                SELECT conrelid, unnest(conkey) AS attnum
                FROM pg_catalog.pg_constraint
                WHERE contype = 'p'
            ) pk ON pk.conrelid = c.oid AND pk.attnum = a.attnum
            WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
              AND (c.relname = %s OR lower(c.relname) = lower(%s))
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
        """
        try:
            res = self.execute(query, [target_schema, target_schema, table_name, table_name], limit=0, database=database)
            items = []
            for row in res.get("rows", []):
                col_name, data_type, is_null, is_pk = row[0], row[1], bool(row[2]), bool(row[3])
                items.append({
                    "name": col_name,
                    "type": "column",
                    "schema": target_schema,
                    "data_type": data_type,
                    "is_nullable": is_null,
                    "is_pk": is_pk
                })
            return items
        except Exception:
            return []

    def get_intellisense_parameters(self, database=None, schema=None, object_name=None):
        if not object_name:
            return []
        target_schema = schema or "public"
        query = """
            SELECT parameter_name, data_type, parameter_mode
            FROM information_schema.parameters
            WHERE specific_schema = %s AND specific_name LIKE %s
            ORDER BY ordinal_position
        """
        try:
            res = self.execute(query, [target_schema, f"{object_name}%"], limit=0, database=database)
            params_list = []
            for row in res.get("rows", []):
                p_name, d_type, p_mode = row[0] or "param", row[1], row[2]
                params_list.append({
                    "name": p_name,
                    "data_type": d_type,
                    "is_output": p_mode in ["OUT", "INOUT"]
                })
            return params_list
        except Exception:
            return []

    def list_object_children(
        self,
        database,
        schema,
        name,
        object_type,
        child_type,
    ):
        items = []
        target_schema = (schema or "public").strip()

        if child_type == "columns":
            attr_sql = """
                SELECT 
                    a.attname AS column_name,
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                    NULL AS character_maximum_length,
                    NOT a.attnotnull AS is_nullable
                FROM pg_catalog.pg_attribute a
                JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND a.attnum > 0
                  AND NOT a.attisdropped
                ORDER BY a.attnum
            """
            attr_res = self.execute(attr_sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in attr_res.get("rows", []):
                items.append({"name": r[0], "type": r[1], "length": r[2], "nullable": bool(r[3])})
                
        elif child_type == "keys":
            sql = """
                SELECT con.conname AS constraint_name,
                       CASE con.contype
                           WHEN 'p' THEN 'PRIMARY KEY'
                           WHEN 'f' THEN 'FOREIGN KEY'
                           WHEN 'u' THEN 'UNIQUE'
                           ELSE con.contype::text
                       END AS type
                FROM pg_catalog.pg_constraint con
                JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND con.contype IN ('p', 'f', 'u')
                ORDER BY con.conname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "constraints":
            sql = """
                SELECT con.conname AS constraint_name, 'CHECK' AS type
                FROM pg_catalog.pg_constraint con
                JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND con.contype = 'c'
                ORDER BY con.conname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "triggers":
            sql = """
                SELECT t.tgname AS trigger_name
                FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND NOT t.tgisinternal
                ORDER BY t.tgname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0]})
                
        elif child_type == "indexes":
            sql = """
                SELECT indexname
                FROM pg_catalog.pg_indexes
                WHERE (schemaname = %s OR lower(schemaname) = lower(%s))
                  AND (tablename = %s OR lower(tablename) = lower(%s))
                ORDER BY indexname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0]})
                
        elif child_type == "params":
            pure_name = name
            identity_args = ""
            if "(" in name and name.endswith(")"):
                parts = name.split("(", 1)
                pure_name = parts[0].strip()
                identity_args = parts[1].rstrip(")").strip()

            sql = """
                SELECT 
                    COALESCE(p.parameter_name, 'arg' || p.ordinal_position) AS parameter_name,
                    p.data_type,
                    p.parameter_mode
                FROM information_schema.parameters p
                JOIN pg_catalog.pg_proc pr 
                  ON p.specific_name = pr.proname || '_' || pr.oid::text
                JOIN pg_catalog.pg_namespace n 
                  ON n.oid = pr.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (pr.proname = %s OR lower(pr.proname) = lower(%s))
            """
            params = [target_schema, target_schema, pure_name, pure_name]
            if identity_args:
                sql += """
                  AND (
                      pg_catalog.pg_get_function_identity_arguments(pr.oid) = %s
                      OR lower(pg_catalog.pg_get_function_identity_arguments(pr.oid)) = lower(%s)
                  )
                """
                params.extend([identity_args, identity_args])
            sql += "\n                ORDER BY p.ordinal_position"

            res = self.execute(sql, tuple(params), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0], "type": r[1]})

            # Fallback if information_schema.parameters has no rows
            if not items:
                fallback_sql = """
                    SELECT 
                        COALESCE(p.proargnames[s.i], 'arg' || s.i) AS name,
                        pg_catalog.format_type(COALESCE(p.proallargtypes[s.i], p.proargtypes[s.i - 1]), NULL) AS type
                    FROM pg_catalog.pg_proc p
                    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    CROSS JOIN LATERAL generate_subscripts(COALESCE(p.proallargtypes, p.proargtypes::oid[]), 1) AS s(i)
                    WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                      AND (p.proname = %s OR lower(p.proname) = lower(%s))
                """
                fb_params = [target_schema, target_schema, pure_name, pure_name]
                if identity_args:
                    fallback_sql += """
                      AND (
                          pg_catalog.pg_get_function_identity_arguments(p.oid) = %s
                          OR lower(pg_catalog.pg_get_function_identity_arguments(p.oid)) = lower(%s)
                      )
                    """
                    fb_params.extend([identity_args, identity_args])
                fallback_sql += "\n                    ORDER BY s.i"
                try:
                    fb_res = self.execute(fallback_sql, tuple(fb_params), limit=0, database=database)
                    for r in fb_res.get("rows", []):
                        if r and r[0]:
                            items.append({"name": r[0], "type": r[1] or "any"})
                except Exception:
                    pass
                
        return items

    def get_supported_types(self, database=None):
        user_types = []
        try:
            udt_sql = """
                SELECT t.typname
                FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                LEFT JOIN pg_class c ON c.oid = t.typrelid
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND (
                      t.typtype IN ('d', 'e')
                      OR (t.typtype = 'c' AND c.relkind = 'c')
                  )
                ORDER BY t.typname
            """
            res = self.execute(udt_sql, limit=0, database=database)
            if res and res.get("rows"):
                user_types = [r[0] for r in res["rows"] if r and r[0]]
        except Exception:
            pass

        return {
            "engine": "postgresql",
            "types": [
                "bigint", "bigserial", "bit", "boolean", "bytea", "char",
                "date", "double precision", "integer", "json", "jsonb", "numeric",
                "real", "serial", "smallint", "smallserial", "text", "time",
                "timestamp", "timestamptz", "uuid", "varchar", "xml"
            ],
            "user_types": user_types,
            "collations": [
                "default",
                "C",
                "POSIX",
                "en_US.utf8",
                "vi_VN.utf8"
            ]
        }

    def get_table_design_metadata(self, database, schema, table):
        schema_name = schema or "public"

        # Check table exists
        check_sql = """
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = %s AND table_name = %s
        """
        check_res = self.execute(check_sql, (schema_name, table), database=database)
        if not check_res.get("rows"):
            return None

        # 1. Columns
        col_sql = """
            SELECT 
                c.ordinal_position,
                c.column_name,
                c.data_type,
                c.udt_name,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale,
                c.is_nullable,
                c.is_identity,
                c.column_default,
                c.collation_name,
                CASE WHEN pk_cols.attname IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
                col_description(c_tbl.oid, c.ordinal_position) AS description
            FROM information_schema.columns c
            JOIN pg_class c_tbl ON c_tbl.relname = c.table_name
            JOIN pg_namespace n_tbl ON n_tbl.oid = c_tbl.relnamespace AND n_tbl.nspname = c.table_schema
            LEFT JOIN (
                SELECT a.attname
                FROM pg_index i
                JOIN pg_class c_pk ON c_pk.oid = i.indrelid
                JOIN pg_namespace n_pk ON n_pk.oid = c_pk.relnamespace
                JOIN pg_attribute a ON a.attrelid = c_pk.oid AND a.attnum = ANY(i.indkey)
                WHERE n_pk.nspname = %s AND c_pk.relname = %s AND i.indisprimary
            ) pk_cols ON pk_cols.attname = c.column_name
            WHERE c.table_schema = %s AND c.table_name = %s
            ORDER BY c.ordinal_position
        """
        col_res = self.execute(col_sql, (schema_name, table, schema_name, table), limit=0, database=database)
        columns = []
        for r in col_res.get("rows", []):
            raw_type = (r[2] or "").lower()
            udt_name = (r[3] or "").lower()
            
            # Normalize display type
            if raw_type == "character varying":
                norm_type = "varchar"
            elif raw_type == "character":
                norm_type = "char"
            elif raw_type == "timestamp without time zone":
                norm_type = "timestamp"
            elif raw_type == "timestamp with time zone":
                norm_type = "timestamptz"
            elif raw_type == "time without time zone":
                norm_type = "time"
            elif raw_type == "time with time zone":
                norm_type = "timetz"
            elif raw_type == "USER-DEFINED":
                norm_type = udt_name
            else:
                norm_type = raw_type

            # Size
            size_str = ""
            if r[4] is not None:
                size_str = str(r[4])
            elif r[5] is not None and norm_type == "numeric":
                size_str = str(r[5])

            scale_str = str(r[6]) if r[6] is not None and norm_type == "numeric" else ""

            # Default and identity
            default_val = r[9] or ""
            is_identity = (r[8] == "YES") or ("nextval(" in default_val)
            if is_identity and "nextval(" in default_val:
                # Often serial in Postgres
                if norm_type == "integer":
                    norm_type = "serial"
                elif norm_type == "bigint":
                    norm_type = "bigserial"
                elif norm_type == "smallint":
                    norm_type = "smallserial"
            else:
                # Clean postgres cast e.g. "'-1'::integer" -> "-1", "0::numeric" -> "0"
                if "::" in default_val:
                    default_val = default_val.split("::")[0].strip()
                is_numeric = norm_type in ("int", "integer", "bigint", "smallint", "numeric", "decimal", "real", "double precision")
                if is_numeric:
                    while (default_val.startswith("'") and default_val.endswith("'")) or (default_val.startswith('"') and default_val.endswith('"')):
                        default_val = default_val[1:-1].strip()

            columns.append({
                "name": r[1],
                "type": norm_type,
                "size": size_str,
                "scale": scale_str,
                "nullable": (r[7] == "YES"),
                "is_pk": bool(r[11]),
                "is_identity": is_identity,
                "identity_seed": 1,
                "identity_increment": 1,
                "default_value": default_val,
                "collation": r[10] or "",
                "comment": r[12] or ""
            })

        # 2. Indexes
        idx_sql = """
            SELECT 
                i.relname AS index_name,
                am.amname AS index_type,
                ix.indisunique AS is_unique,
                ARRAY(
                    SELECT a.attname
                    FROM pg_attribute a
                    WHERE a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                ) AS col_names
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_am am ON am.oid = i.relam
            WHERE n.nspname = %s AND t.relname = %s 
              AND NOT ix.indisprimary
              AND NOT EXISTS (
                  SELECT 1 FROM pg_constraint c 
                  WHERE c.conindid = ix.indexrelid AND c.contype = 'u'
              )
            ORDER BY i.relname
        """
        idx_res = self.execute(idx_sql, (schema_name, table), limit=0, database=database)
        indexes = []
        for r in idx_res.get("rows", []):
            raw_cols = r[3]
            cols = []
            if isinstance(raw_cols, list):
                cols = [{"column": str(c), "desc": False} for c in raw_cols]
            elif isinstance(raw_cols, str):
                # parse postgres array e.g. {col1,col2}
                cleaned = raw_cols.strip("{}").split(",")
                cols = [{"column": c.strip('"'), "desc": False} for c in cleaned if c]

            indexes.append({
                "name": r[0],
                "fields": cols,
                "index_type": (r[1] or "btree").upper(),
                "is_unique": bool(r[2]),
                "comment": ""
            })

        # 3. Foreign Keys
        fk_sql = """
            SELECT
                tc.constraint_name,
                kcu.column_name,
                ccu.table_schema AS ref_schema,
                ccu.table_name AS ref_table,
                ccu.column_name AS ref_column,
                rc.delete_rule,
                rc.update_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints rc
                ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = %s AND tc.table_name = %s
            ORDER BY tc.constraint_name, kcu.ordinal_position
        """
        fk_res = self.execute(fk_sql, (schema_name, table), limit=0, database=database)
        fk_map = {}
        for r in fk_res.get("rows", []):
            fk_name = r[0]
            if fk_name not in fk_map:
                fk_map[fk_name] = {
                    "name": fk_name,
                    "fields": [],
                    "ref_schema": r[2],
                    "ref_table": r[3],
                    "ref_fields": [],
                    "on_delete": r[5] or "NO ACTION",
                    "on_update": r[6] or "NO ACTION",
                    "is_enabled": True,
                    "not_for_replication": False,
                    "comment": ""
                }
            fk_map[fk_name]["fields"].append(r[1])
            fk_map[fk_name]["ref_fields"].append(r[4])
        foreign_keys = list(fk_map.values())

        # 4. Uniques
        uq_sql = """
            SELECT
                tc.constraint_name,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'UNIQUE'
                AND tc.table_schema = %s AND tc.table_name = %s
            ORDER BY tc.constraint_name, kcu.ordinal_position
        """
        uq_res = self.execute(uq_sql, (schema_name, table), limit=0, database=database)
        uq_map = {}
        for r in uq_res.get("rows", []):
            uq_name = r[0]
            if uq_name not in uq_map:
                uq_map[uq_name] = {
                    "name": uq_name,
                    "fields": [],
                    "is_clustered": False,
                    "comment": ""
                }
            uq_map[uq_name]["fields"].append(r[1])
        uniques = list(uq_map.values())

        # 5. Checks
        chk_sql = """
            SELECT
                tc.constraint_name,
                cc.check_clause
            FROM information_schema.table_constraints tc
            JOIN information_schema.check_constraints cc
                ON cc.constraint_name = tc.constraint_name AND cc.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'CHECK'
                AND tc.table_schema = %s AND tc.table_name = %s
                AND tc.constraint_name NOT LIKE '%%_not_null'
            ORDER BY tc.constraint_name
        """
        chk_res = self.execute(chk_sql, (schema_name, table), limit=0, database=database)
        checks = []
        for r in chk_res.get("rows", []):
            clause = r[1] or ""
            checks.append({
                "name": r[0],
                "check_clause": clause,
                "is_enabled": True,
                "not_for_replication": False,
                "comment": ""
            })

        # 6. Triggers
        trig_sql = """
            SELECT 
                tr.trigger_name,
                tr.action_timing,
                tr.event_manipulation,
                pg_get_triggerdef(pg_t.oid, true) as trigger_def
            FROM information_schema.triggers tr
            JOIN pg_class pg_c ON pg_c.relname = tr.event_object_table
            JOIN pg_namespace pg_n ON pg_n.oid = pg_c.relnamespace AND pg_n.nspname = tr.event_object_schema
            JOIN pg_trigger pg_t ON pg_t.tgrelid = pg_c.oid AND pg_t.tgname = tr.trigger_name
            WHERE tr.event_object_schema = %s AND tr.event_object_table = %s
            ORDER BY tr.trigger_name
        """
        trig_res = self.execute(trig_sql, (schema_name, table), limit=0, database=database)
        trig_map = {}
        for r in trig_res.get("rows", []):
            t_name = r[0]
            timing = (r[1] or "AFTER").capitalize() # Before, After, Instead Of
            event = (r[2] or "").upper()
            if t_name not in trig_map:
                trig_map[t_name] = {
                    "name": t_name,
                    "fires": timing,
                    "is_insert": False,
                    "is_update": False,
                    "is_delete": False,
                    "is_enabled": True,
                    "definition": r[3] or "",
                    "comment": ""
                }
            if event == "INSERT":
                trig_map[t_name]["is_insert"] = True
            elif event == "UPDATE":
                trig_map[t_name]["is_update"] = True
            elif event == "DELETE":
                trig_map[t_name]["is_delete"] = True
        triggers = list(trig_map.values())

        return {
            "database": database,
            "schema": schema_name,
            "table": table,
            "engine": "postgresql",
            "columns": columns,
            "indexes": indexes,
            "foreign_keys": foreign_keys,
            "uniques": uniques,
            "checks": checks,
            "triggers": triggers
        }

    def execute_migration_transaction(self, batches: list[str], database: str = None):
        """Executes a list of SQL batches within a single atomic transaction.
        If any statement fails, rolls back completely and re-raises.
        """
        if not self.connection:
            self.connect()

        self.connection.autocommit = False
        try:
            with self.connection.cursor() as cursor:
                for b in batches:
                    clean_b = b.strip()
                    if not clean_b:
                        continue
                    cursor.execute(clean_b)
            self.connection.commit()
        except Exception as exc:
            try:
                self.connection.rollback()
            except Exception:
                pass
            raise exc
        finally:
            self.connection.autocommit = True

    def get_foreign_keys(self, database=None, schema=None, table=None):
        sql = """
            SELECT
                tc.constraint_name,
                tc.table_schema AS from_schema,
                tc.table_name AS from_table,
                kcu.column_name AS from_column,
                ccu.table_schema AS to_schema,
                ccu.table_name AS to_table,
                ccu.column_name AS to_column,
                kcu.ordinal_position
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
        """

        where_clauses = []
        params = []

        if table:
            clean_tbl = table.strip('" \t\r\n')
            if schema:
                clean_sch = schema.strip('" \t\r\n')
                where_clauses.append(
                    "(((tc.table_schema = %s OR LOWER(tc.table_schema) = LOWER(%s)) AND (tc.table_name = %s OR LOWER(tc.table_name) = LOWER(%s))) "
                    "OR ((ccu.table_schema = %s OR LOWER(ccu.table_schema) = LOWER(%s)) AND (ccu.table_name = %s OR LOWER(ccu.table_name) = LOWER(%s))))"
                )
                params.extend([clean_sch, clean_sch, clean_tbl, clean_tbl, clean_sch, clean_sch, clean_tbl, clean_tbl])
            else:
                where_clauses.append(
                    "((tc.table_name = %s OR LOWER(tc.table_name) = LOWER(%s)) "
                    "OR (ccu.table_name = %s OR LOWER(ccu.table_name) = LOWER(%s)))"
                )
                params.extend([clean_tbl, clean_tbl, clean_tbl, clean_tbl])
        elif schema:
            clean_sch = schema.strip('" \t\r\n')
            where_clauses.append("(tc.table_schema = %s OR ccu.table_schema = %s)")
            params.extend([clean_sch, clean_sch])

        if where_clauses:
            sql += " AND " + " AND ".join(where_clauses)

        sql += " ORDER BY tc.constraint_name, kcu.ordinal_position"

        try:
            res = self.execute(sql, tuple(params) if params else None, limit=0, database=database)
            fk_map = {}
            for r in res.get("rows", []):
                c_name, f_sch, f_tbl, f_col, t_sch, t_tbl, t_col, _ = r
                key = f"{f_sch}::{f_tbl}::{c_name}::{t_sch}::{t_tbl}"
                if key not in fk_map:
                    fk_map[key] = {
                        "constraint_name": c_name,
                        "from_schema": f_sch,
                        "from_table": f_tbl,
                        "from_columns": [],
                        "to_schema": t_sch,
                        "to_table": t_tbl,
                        "to_columns": []
                    }
                fk_map[key]["from_columns"].append(f_col)
                fk_map[key]["to_columns"].append(t_col)

            return list(fk_map.values())
        except Exception:
            return []

    def list_foreign_servers(self, database=None):
        sql = """
            SELECT s.srvname, w.fdwname, s.srvtype, s.srvversion
            FROM pg_catalog.pg_foreign_server s
            JOIN pg_catalog.pg_foreign_data_wrapper w ON w.oid = s.srvfdw
            ORDER BY s.srvname
        """
        try:
            res = self.execute(sql, limit=0, database=database)
            return [
                {
                    "name": row[0],
                    "fdw": row[1],
                    "wrapper": row[1],
                    "type": row[2] or "",
                    "version": row[3] or ""
                }
                for row in res.get("rows", [])
            ]
        except Exception:
            return []

    def list_foreign_tables(self, database=None, schema=None):
        sql = """
            SELECT c.relname, n.nspname, s.srvname
            FROM pg_catalog.pg_foreign_table ft
            JOIN pg_catalog.pg_class c ON c.oid = ft.ftrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_foreign_server s ON s.oid = ft.ftserver
        """
        params = []
        if schema:
            clean_sch = schema.strip("[] \t\r\n")
            sql += " WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))"
            params.extend([clean_sch, clean_sch])
        sql += " ORDER BY c.relname"
        try:
            res = self.execute(sql, params if params else None, limit=0, database=database)
            return [
                {
                    "name": row[0],
                    "schema": row[1],
                    "server": row[2],
                    "type": "foreign_table"
                }
                for row in res.get("rows", [])
            ]
        except Exception:
            return []

# Alias for compatibility
PostgresAdapter = PostgreSqlAdapter


