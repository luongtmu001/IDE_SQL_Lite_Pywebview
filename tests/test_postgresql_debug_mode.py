"""Test Suite for PostgreSQL IDE Debug Extensions & Debug Mode
Reference: .SKILL/custom_function_debug.md and postgresql_debug_extension_plan.md
"""

import json
from unittest.mock import MagicMock, patch
try:
    import pytest
except ImportError:
    pytest = None
try:
    from app import create_app
except ImportError:
    create_app = None
from app.database.debug.instrumenter import (
    comment_out_debug_extensions,
    detect_debug_extensions,
    get_collect_debug_sql,
    get_setup_debug_sql,
    instrument_sql_for_debug,
    process_collected_telemetry,
)


class TestDebugExtensionDetector:
    """Phase 2: Extension Detector Tests."""

    def test_detect_single_bs_trace(self):
        sql = "SELECT 1;\nbs.trace(SELECT id, name FROM users);\nSELECT 2;"
        matches = detect_debug_extensions(sql)
        assert len(matches) == 1
        m = matches[0]
        assert m["name"] == "bs.trace"
        assert m["command"] == "trace"
        assert m["sourceTraceId"] == "trace_1"
        assert m["sourceOrder"] == 1
        assert m["startLine"] == 2
        assert "SELECT id, name FROM users" in m["innerContent"]

    def test_ignore_in_comments_and_strings(self):
        sql = """
        -- bs.trace(SELECT 1);
        /* bs.trace(SELECT 2); */
        SELECT 'bs.trace(SELECT 3)' AS dummy;
        bs.trace(SELECT 4);
        """
        matches = detect_debug_extensions(sql)
        assert len(matches) == 1
        assert matches[0]["innerContent"] == "SELECT 4"

    def test_detect_multiple_traces_and_loops(self):
        sql = """
        DO $$
        BEGIN
            bs.trace(SELECT * FROM customers);
            FOR r IN SELECT * FROM orders LOOP
                bs.trace(SELECT * FROM order_items WHERE order_id = r.id);
            END LOOP;
        END $$;
        """
        matches = detect_debug_extensions(sql)
        assert len(matches) == 2
        assert matches[0]["sourceTraceId"] == "trace_1"
        assert matches[1]["sourceTraceId"] == "trace_2"

    def test_comment_out_debug_extensions(self):
        sql = "SELECT 1;\nbs.trace(\n    SELECT * FROM test\n);\nSELECT 2;"
        new_sql, count = comment_out_debug_extensions(sql)
        assert count == 1
        assert "bs.trace" not in [line.strip() for line in new_sql.split("\n") if not line.strip().startswith("--")]
        assert "-- bs.trace(" in new_sql
        assert "    -- SELECT * FROM test" in new_sql
        assert "SELECT 1;" in new_sql
        assert "SELECT 2;" in new_sql


class TestDebugInstrumentation:
    """Phase 4 & 5: SQL Transformation & Telemetry Processing."""

    def test_instrument_sql(self):
        sql = "DO $$ BEGIN bs.trace(SELECT 100 AS num); END $$;"
        inst_sql, traces = instrument_sql_for_debug(sql)
        assert len(traces) == 1
        assert "INSERT INTO _ide_debug_trace_queue" in inst_sql
        assert "SELECT 'trace_1'" in inst_sql
        assert "(SELECT 100 AS num)" in inst_sql

    def test_instrument_sql_multiple_traces_semicolons(self):
        sql = """
        bs.trace(SELECT * FROM b00command;)
        bs.trace(SELECT * FROM b00lookup;)
        """
        inst_sql, traces = instrument_sql_for_debug(sql)
        assert len(traces) == 2
        # Verify both INSERT statements end with a semicolon and no syntax-breaking concatenation
        lines = [line.strip() for line in inst_sql.strip().split("\n") if line.strip()]
        assert len(lines) == 2
        assert lines[0].endswith(";")
        assert lines[1].endswith(";")
        assert not lines[0].endswith(";;")
        assert not lines[1].endswith(";;")


    def test_setup_and_collect_sql(self):
        setup_sql = get_setup_debug_sql()
        assert "CREATE TEMP TABLE IF NOT EXISTS _ide_debug_trace_queue" in setup_sql
        assert "TRUNCATE _ide_debug_trace_queue" in setup_sql

        collect_sql = get_collect_debug_sql()
        assert "SELECT trace_id, payload_json, logged_at" in collect_sql
        assert "ORDER BY seq_id" in collect_sql

    def test_process_collected_telemetry_with_loop_iterations(self):
        raw_rows = [
            ("trace_1", json.dumps([{"id": 1, "name": "Customer 1"}]), "2026-10-02 20:00:00"),
            ("trace_2", json.dumps([{"item": "A", "price": 10}]), "2026-10-02 20:00:01"),
            ("trace_2", json.dumps([{"item": "B", "price": 20}]), "2026-10-02 20:00:02"),
            ("trace_2", json.dumps([{"item": "C", "price": 30}]), "2026-10-02 20:00:03"),
        ]

        trace_defs = [
            {"sourceTraceId": "trace_1", "startLine": 5, "startCol": 9},
            {"sourceTraceId": "trace_2", "startLine": 10, "startCol": 13},
        ]

        events = process_collected_telemetry(raw_rows, trace_defs)
        assert len(events) == 4

        # Event 1: trace_1, iteration 1, runtime_order 1
        assert events[0]["trace_id"] == "trace_1"
        assert events[0]["runtime_order"] == 1
        assert events[0]["iteration"] == 1
        assert events[0]["columns"] == ["id", "name"]
        assert events[0]["rows"] == [[1, "Customer 1"]]

        # Event 2: trace_2, iteration 1, runtime_order 2
        assert events[1]["trace_id"] == "trace_2"
        assert events[1]["runtime_order"] == 2
        assert events[1]["iteration"] == 1

        # Event 3: trace_2, iteration 2, runtime_order 3
        assert events[2]["trace_id"] == "trace_2"
        assert events[2]["runtime_order"] == 3
        assert events[2]["iteration"] == 2
        assert events[2]["rows"] == [["B", 20]]

        # Event 4: trace_2, iteration 3, runtime_order 4
        assert events[3]["trace_id"] == "trace_2"
        assert events[3]["runtime_order"] == 4
        assert events[3]["iteration"] == 3


class TestDebugQueryExecutionAPI:
    """Integration test with Flask endpoint /api/query/execute."""

    def test_execute_in_debug_mode(self):
        if create_app is None:
            return
        app = create_app()
        app.config.update(TESTING=True)

        with app.test_client() as client:
            with patch("app.routes.query.get_connection_manager") as mock_cm, \
                 patch("app.routes.query.get_owner_session_id") as mock_sid:
                mock_sid.return_value = "owner_debug"
                mock_mgr = MagicMock()
                mock_conn = MagicMock()
                mock_conn.query_service.execute.return_value = {
                    "success": True,
                    "mode": "debug",
                    "debug_session_id": "DBG_20261002_TEST",
                    "results": [],
                    "trace_results": [
                        {
                            "trace_id": "trace_1",
                            "runtime_order": 1,
                            "iteration": 1,
                            "columns": ["val"],
                            "rows": [[42]],
                            "row_count": 1,
                            "source_location": {"startLine": 2, "startCol": 5},
                        }
                    ],
                    "messages": ["[DEBUG SESSION: DBG_20261002_TEST]"],
                }
                mock_mgr.get.return_value = mock_conn
                mock_cm.return_value = mock_mgr

                res = client.post("/api/query/execute", json={
                    "connection_id": "pg_conn_1",
                    "sql": "bs.trace(SELECT 42 AS val);",
                    "mode": "debug",
                    "debug_session_id": "DBG_20261002_TEST",
                    "traces": [
                        {"sourceTraceId": "trace_1", "command": "trace", "startLine": 1, "startCol": 1}
                    ]
                })

                assert res.status_code == 200
                data = res.json
                assert data["success"] is True
                assert data["mode"] == "debug"
                assert len(data["trace_results"]) == 1
                assert data["trace_results"][0]["trace_id"] == "trace_1"
                assert data["trace_results"][0]["rows"] == [[42]]

    def test_instrument_sql_with_empty_traces_list(self):
        """Verify that passing empty traces=[] does NOT bypass server-side detection."""
        sql = "bs.trace(Select * from b00command)"
        inst_sql, traces = instrument_sql_for_debug(sql, traces=[])
        assert len(traces) == 1
        assert traces[0]["command"] == "trace"
        assert "INSERT INTO _ide_debug_trace_queue" in inst_sql
        assert "(Select * from b00command)" in inst_sql
        assert "bs.trace" not in inst_sql

    def test_adapter_execute_debug_populates_grid_results(self):
        """Verify PostgreSqlAdapter.execute_debug captures telemetry and formats it into results for the grid."""
        from app.database.postgresql import PostgreSqlAdapter

        adapter = PostgreSqlAdapter({"type": "postgresql", "database": "testdb"})
        sql = "bs.trace(Select * from b00command)"

        call_log = []

        def mock_execute(query, *args, **kwargs):
            call_log.append(query)
            if "SELECT trace_id, payload_json, logged_at" in query:
                # Return simulated collected telemetry
                payload = json.dumps([
                    {"command_id": "CMD_01", "command_name": "Test Command 1"},
                    {"command_id": "CMD_02", "command_name": "Test Command 2"},
                ])
                return {
                    "success": True,
                    "columns": ["trace_id", "payload_json", "logged_at"],
                    "rows": [["trace_1", payload, "2026-10-03 18:00:00"]],
                    "row_count": 1,
                    "results": []
                }
            elif "INSERT INTO _ide_debug_trace_queue" in query:
                # INSERT query execution
                return {
                    "success": True,
                    "columns": [],
                    "rows": [],
                    "row_count": 1,
                    "results": [],
                    "messages": ["(1 row affected)"],
                    "errors": []
                }
            else:
                return {
                    "success": True,
                    "columns": [],
                    "rows": [],
                    "row_count": 0,
                    "results": [],
                    "messages": [],
                    "errors": []
                }

        adapter.execute = mock_execute

        res = adapter.execute_debug(sql, debug_session_id="DBG_20261003_TEST")

        assert res["success"] is True
        assert res["mode"] == "debug"
        assert res["debug_session_id"] == "DBG_20261003_TEST"

        # Check trace results
        assert len(res["trace_results"]) == 1
        tr = res["trace_results"][0]
        assert tr["trace_id"] == "trace_1"
        assert tr["columns"] == ["command_id", "command_name"]
        assert len(tr["rows"]) == 2
        assert tr["rows"][0] == ["CMD_01", "Test Command 1"]

        # Check that main_result["results"] contains ordered results (both queries and traces)
        assert len(res["results"]) == 1
        assert res["results"][0]["isTrace"] is True
        assert res["results"][0]["traceId"] == "trace_1"

    def test_serialize_cell_and_telemetry_ast_fallback(self):
        """Verify serialize_cell outputs valid JSON and process_collected_telemetry handles python repr strings."""
        from app.database.postgresql import serialize_cell

        data_obj = [{"id": 10, "label": "Test Label", "active": True}]
        serialized = serialize_cell(data_obj)
        assert isinstance(serialized, str)
        assert '"id": 10' in serialized
        assert '"active": true' in serialized

        # Test telemetry parsing both valid JSON and Python repr string
        python_repr_str = "[{'id': 101, 'code': 'A01', 'active': False}]"
        raw_rows = [["trace_1", python_repr_str, "2026-10-03 12:00:00"]]
        defs = [{"sourceTraceId": "trace_1"}]
        events = process_collected_telemetry(raw_rows, defs)
        assert len(events) == 1
        assert events[0]["columns"] == ["id", "code", "active"]
        assert events[0]["rows"] == [[101, "A01", False]]
        assert events[0]["row_count"] == 1

    def test_instrument_sql_inside_function_with_temp_table(self):
        """Verify instrumenting bs.trace inside a PL/pgSQL function selecting from temp table."""
        fn_sql = """
        CREATE OR REPLACE FUNCTION dbo.test_temp()
        RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
            bs.trace(SELECT * FROM tmp_my_table ORDER BY id);
        END;
        $$;
        """
        inst_sql, traces = instrument_sql_for_debug(fn_sql)
        assert len(traces) == 1
        assert "INSERT INTO _ide_debug_trace_queue" in inst_sql
        assert "(SELECT * FROM tmp_my_table ORDER BY id)" in inst_sql
        assert "$$" in inst_sql
        assert "bs.trace" not in inst_sql

    def test_main_execute_query_passes_debug_mode(self):
        """Verify main.py execute_query forwards mode, debug_session_id, and traces to QueryService."""
        import sys
        if "webview" not in sys.modules:
            try:
                import webview
            except ImportError:
                sys.modules["webview"] = MagicMock()
        import main

        mock_conn = MagicMock()
        mock_conn.query_service = MagicMock()
        mock_conn.query_service.execute.return_value = {
            "success": True,
            "mode": "debug",
            "debug_session_id": "DBG_MAIN_TEST",
            "results": [],
            "trace_results": [{"trace_id": "trace_1", "columns": ["x"], "rows": [[1]]}]
        }

        # Mock _get_connection in main
        with patch.object(main.connection_manager, "get", return_value=mock_conn):
            # Create a mock webview app or instantiate the API host object
            class DummyAPI:
                _get_connection = main.TableDesignerService if hasattr(main, "_get_connection") else None

            # Or test execute_query method directly on the class or helper
            # Find the class containing execute_query in main.py
            # In main.py, execute_query is a method of the API class passed to pywebview
            for name, obj in vars(main).items():
                if isinstance(obj, type) and hasattr(obj, "execute_query"):
                    api_instance = obj()
                    with patch.object(api_instance, "_get_connection", return_value=mock_conn):
                        result = api_instance.execute_query(
                            connection_id="pg_conn",
                            sql="bs.trace(Select * from b00command)",
                            limit=500,
                            database="Bravo",
                            schema="public",
                            query_id="q123",
                            mode="debug",
                            debug_session_id="DBG_MAIN_TEST",
                            traces=[]
                        )
                        assert result["success"] is True
                        assert result["mode"] == "debug"
                        mock_conn.query_service.execute.assert_called_once_with(
                            "bs.trace(Select * from b00command)",
                            limit=500,
                            database="Bravo",
                            schema="public",
                            progress_callback=mock_conn.query_service.execute.call_args.kwargs.get("progress_callback"),
                            mode="debug",
                            debug_session_id="DBG_MAIN_TEST",
                            traces=[],
                            parameters=None,
                            stop_on_error=True
                        )
                        break

    def test_multiple_bs_trace_semicolon_termination(self):
        """Verify that multiple consecutive bs.trace calls have semicolons so PG doesn't syntax error."""
        from app.database.debug.instrumenter import instrument_sql_for_debug
        sql = """
        bs.trace(SELECT * FROM b00command;)
        bs.trace(SELECT * FROM b00lookup;)
        """
        inst_sql, traces = instrument_sql_for_debug(sql)
        assert len(traces) == 2
        # Verify that both INSERT statements end with a semicolon
        insert_statements = [line.strip() for line in inst_sql.splitlines() if "INSERT INTO _ide_debug_trace_queue" in line]
        assert len(insert_statements) == 2
        for stmt in insert_statements:
            assert stmt.endswith(";")

    def test_transform_pg_temp_tables(self):
        """Verify transformation of #temp_table syntax to PostgreSQL temp tables."""
        from app.database.debug.instrumenter import transform_pg_temp_tables
        sql1 = "SELECT * FROM #b00command;"
        assert transform_pg_temp_tables(sql1) == "SELECT * FROM bs_temp_b00command;"

        sql2 = "CREATE TABLE #b00command (id int);"
        assert transform_pg_temp_tables(sql2) == "CREATE TEMP TABLE bs_temp_b00command (id int);"

        sql3 = "SELECT 1 INTO #b00command;"
        assert transform_pg_temp_tables(sql3) == "SELECT 1 INTO TEMP bs_temp_b00command;"

        sql4 = "SELECT '#literal', col FROM #real_table;"
        assert transform_pg_temp_tables(sql4) == "SELECT '#literal', col FROM bs_temp_real_table;"

        # Preserves dollar-quoted blocks
        sql5 = "SELECT $$#not_temp_in_dollar$$ AS txt, col FROM #real_table;"
        assert transform_pg_temp_tables(sql5) == "SELECT $$#not_temp_in_dollar$$ AS txt, col FROM bs_temp_real_table;"

        # Preserves double-quoted identifiers
        sql6 = 'SELECT "my#column", "#col2" FROM #table;'
        assert transform_pg_temp_tables(sql6) == 'SELECT "my#column", "#col2" FROM bs_temp_table;'

        # Preserves escape string literals E'...'
        sql7 = r"SELECT E'escaped \' #not_temp', col FROM #table;"
        assert transform_pg_temp_tables(sql7) == r"SELECT E'escaped \' #not_temp', col FROM bs_temp_table;"

        # Preserves PostgreSQL operators (#>, #>>, #-, ##)
        sql8 = "SELECT data #> '{a,b}', data #>> '{c}', data #- '{d}' FROM #table;"
        assert transform_pg_temp_tables(sql8) == "SELECT data #> '{a,b}', data #>> '{c}', data #- '{d}' FROM bs_temp_table;"

    def test_strip_debug_injections_from_function(self):
        """Verify stripping of debug trace injections when restoring a function."""
        from app.database.debug.instrumenter import strip_debug_injections_from_function
        func_def = """CREATE OR REPLACE FUNCTION dbo.test_func()
RETURNS int LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO _ide_debug_trace_queue (trace_id, payload_json) SELECT 'trace_1', ...;
    RETURN 1;
END;
$$;"""
        cleaned = strip_debug_injections_from_function(func_def)
        assert "_ide_debug_trace_queue" not in cleaned
        assert "RETURN 1;" in cleaned

    def test_detect_debug_extensions_in_single_quoted_routine_bodies(self):
        """Verify detect_debug_extensions detects debug calls inside AS '...' and DO '...' single-quoted blocks."""
        sql1 = """
        CREATE OR REPLACE FUNCTION test_single_quoted() RETURNS void AS '
        BEGIN
            bs.trace(SELECT * FROM my_table);
        END;
        ' LANGUAGE plpgsql;
        """
        matches1 = detect_debug_extensions(sql1)
        assert len(matches1) == 1
        assert matches1[0]["name"] == "bs.trace"
        assert "SELECT * FROM my_table" in matches1[0]["innerContent"]

        sql2 = "DO 'BEGIN bs.print(''debug line''); END;';"
        matches2 = detect_debug_extensions(sql2)
        assert len(matches2) == 1
        assert matches2[0]["name"] == "bs.print"

    def test_modal_z_index_and_backdrop_protection(self):
        """Verify ide-modal-debug-extension-warning is above backdrop (z-index >= 10050) in HTML and CSS."""
        from pathlib import Path
        index_html = Path("templates/index.html").read_text(encoding="utf-8")
        editor_partial = Path("templates/partials/editor.html").read_text(encoding="utf-8")
        bravo_css = Path("static/css/bravo.css").read_text(encoding="utf-8")
        style_css = Path("static/css/style.css").read_text(encoding="utf-8")
        query_js = Path("static/js/query.js").read_text(encoding="utf-8")
        registry_js = Path("static/js/debug-extension-registry.js").read_text(encoding="utf-8")

        # HTML static backdrop and z-index check
        assert 'id="ide-modal-debug-extension-warning"' in index_html
        assert 'data-bs-backdrop="static"' in index_html
        assert ('100050' in index_html or '10050' in index_html)
        assert 'id="ide-modal-debug-extension-warning"' in editor_partial

        # CSS z-index check
        assert "#ide-modal-debug-extension-warning" in bravo_css
        assert "#ide-modal-debug-extension-warning" in style_css

        # query.js check: bs.* check must precede SqlProtection fatal actions guard
        assert "window.DebugExtensionRegistry" in query_js
        assert "!shouldBypassBsCheck && window.DebugExtensionRegistry" in query_js
        assert "dbType.toLowerCase() === 'postgresql'" in query_js
        assert "dbType.toLowerCase() === 'postgres'" in query_js

        # Verify ordering: DebugExtensionRegistry (bs.* check) MUST run before SqlProtection (fatal actions guard)
        bs_idx = query_js.find("DebugExtensionRegistry.detectDebugExtensions")
        fatal_idx = query_js.find("SqlProtection.detectFatalSqlActions")
        assert bs_idx != -1 and fatal_idx != -1
        assert bs_idx < fatal_idx, "bs.* check MUST run before SqlProtection fatal actions guard!"

        # debug-extension-registry.js isSupported check
        assert "norm === 'postgres'" in registry_js
        assert "norm === 'postgresql'" in registry_js

    def test_normal_mode_bs_check_priority_and_modal_chaining(self):
        """Verify query.js and debug-extension-registry.js enforce bs.* check priority and sequential modal chaining."""
        from pathlib import Path
        query_js = Path("static/js/query.js").read_text(encoding="utf-8")
        registry_js = Path("static/js/debug-extension-registry.js").read_text(encoding="utf-8")

        # 1. executeQuery signature must accept skipProtection and skipBsCheck
        assert "async function executeQuery(skipProtection = false, skipBsCheck = false" in query_js

        # 2. bs.* warning callback onCommentAndRun must re-invoke executeQuery(false, true) to trigger SqlProtection
        assert "executeQuery(false, true)" in query_js

        # 3. SqlProtection onContinue must invoke executeQuery(true, true) to proceed to server execution
        assert "executeQuery(true, true)" in query_js

        # 4. showNormalModeWarningModal in registry_js must support onCancel and z-index >= 100050
        assert "onCancel" in registry_js
        assert "100050" in registry_js


class TestPostgresDebugSyntaxAndOrder:
    """Tests for debug syntax skipping of bs.* and sequential execution with RETURN early-exit."""

    def test_syntax_check_debug_mode_ignores_bs_functions(self):
        """When is_debug=True, bs.* function syntax is not flagged as error. When is_debug=False, it is flagged."""
        from app.database.syntax.validator import validate_sql

        sql_valid_with_debug = "SELECT 1 AS a;\nbs.trace(SELECT * FROM orders);\nSELECT 2 AS b;"

        # 1. When is_debug=True: bs.trace is NOT flagged as error
        diags_debug = validate_sql(sql_valid_with_debug, dialect="postgres", is_debug=True)
        assert len(diags_debug) == 0

        # 2. When is_debug=False: bs.trace IS flagged as error
        diags_normal = validate_sql(sql_valid_with_debug, dialect="postgres", is_debug=False)
        assert len(diags_normal) > 0
        assert any("bs" in (d.get("token", "") or "").lower() or "bs" in d.get("message", "").lower() for d in diags_normal)

        # 3. Real syntax errors are still detected even when is_debug=True
        sql_with_real_error = "SELECT 1 AS a;\nbs.trace(SELECT * FROM orders);\nSELECT FROM;"
        diags_with_err = validate_sql(sql_with_real_error, dialect="postgres", is_debug=True)
        assert len(diags_with_err) > 0
        assert all(d.get("token") != "bs" for d in diags_with_err)

        # 4. Any bs.* function name is supported
        sql_custom_bs = "SELECT 1;\nbs.custom_debug_fn(123);\nSELECT 2;"
        diags_custom_debug = validate_sql(sql_custom_bs, dialect="postgres", is_debug=True)
        assert len(diags_custom_debug) == 0

    def test_split_postgres_statements_and_return_detection(self):
        """Verify split_postgres_statements and is_return_statement."""
        from app.database.debug.instrumenter import split_postgres_statements, is_return_statement

        sql = """
        SELECT 1 AS first;
        bs.trace(SELECT 2 AS second);
        RETURN;
        SELECT 3 AS third;
        """
        stmts = split_postgres_statements(sql)
        assert len(stmts) == 4
        assert "SELECT 1" in stmts[0]["text"]
        assert "bs.trace" in stmts[1]["text"]
        assert is_return_statement(stmts[2]["text"]) is True
        assert is_return_statement(stmts[0]["text"]) is False

        # Verify dollar quote preservation
        do_sql = """
        DO $$
        BEGIN
            bs.trace(SELECT 1);
            RETURN;
            bs.trace(SELECT 2);
        END $$;
        SELECT 3;
        """
        do_stmts = split_postgres_statements(do_sql)
        assert len(do_stmts) == 2
        assert "DO $$" in do_stmts[0]["text"]
        assert is_return_statement(do_stmts[0]["text"]) is False
        assert "SELECT 3" in do_stmts[1]["text"]

    def test_execute_debug_order_and_return_exit(self):
        """Verify execute_debug orders results chronologically and stops at RETURN."""
        from app.database.postgresql import PostgreSqlAdapter

        adapter = PostgreSqlAdapter({"database": "testdb"})
        adapter.connection = MagicMock()
        adapter.connection.closed = False

        queue_rows = []

        # Mock execute responses for different statements
        def mock_execute(sql, *args, **kwargs):
            nonlocal queue_rows
            clean = sql.strip().upper()
            if "INSERT INTO _IDE_DEBUG_TRACE_QUEUE" in clean:
                queue_rows = [("trace_1", json.dumps([{"id": 2}]), "2026-10-08 10:00:00")]
                return {"success": True, "results": [], "columns": [], "rows": []}
            elif "_IDE_DEBUG_TRACE_QUEUE" in clean and "SELECT TRACE_ID" in clean:
                # Telemetry collect drains queue
                res_rows = list(queue_rows)
                queue_rows = []
                return {
                    "success": True,
                    "rows": res_rows,
                    "columns": ["trace_id", "payload_json", "logged_at"],
                    "results": []
                }
            elif "CREATE TEMP TABLE" in clean or "TRUNCATE" in clean:
                queue_rows = []
                return {"success": True, "results": [], "columns": [], "rows": []}
            elif "SELECT 1" in clean:
                return {
                    "success": True,
                    "results": [{"columns": ["num"], "rows": [[1]], "row_count": 1}],
                    "columns": ["num"],
                    "rows": [[1]],
                    "row_count": 1
                }
            elif "SELECT 3" in clean:
                return {
                    "success": True,
                    "results": [{"columns": ["num"], "rows": [[3]], "row_count": 1}],
                    "columns": ["num"],
                    "rows": [[3]],
                    "row_count": 1
                }
            return {"success": True, "results": [], "columns": [], "rows": []}

        adapter.execute = MagicMock(side_effect=mock_execute)

        # Test script with RETURN early-exit
        sql = """
        SELECT 1 AS num;
        bs.trace(SELECT 2 AS num);
        RETURN;
        SELECT 3 AS num;
        """

        result = adapter.execute_debug(sql)
        assert result["success"] is True
        results = result["results"]

        # Exactly 2 results: Result 1, Trace 1. SELECT 3 below RETURN must be skipped!
        assert len(results) == 2
        assert results[0]["isTrace"] is False
        assert results[0]["rows"] == [[1]]
        assert results[1]["isTrace"] is True
        assert results[1]["rows"] == [[2]]

        # Verify SELECT 3 was never called
        called_sqls = [call.args[0] for call in adapter.execute.call_args_list if call.args]
        assert not any("SELECT 3" in s for s in called_sqls)

    def test_single_bs_trace_statement(self):
        """Verify executing bs.trace(SELECT * FROM b00command); alone returns trace results."""
        from app.database.postgresql import PostgreSqlAdapter
        adapter = PostgreSqlAdapter({"database": "testdb"})
        adapter.connection = MagicMock()
        adapter.connection.closed = False

        def mock_execute(sql_query, **kwargs):
            clean = " ".join(sql_query.split())
            if "FROM _ide_debug_trace_queue" in clean:
                return {
                    "success": True,
                    "rows": [["trace_1", json.dumps([{"cmd_id": "CMD01", "cmd_name": "Open"}]), "2026-10-08 15:56:00"]],
                    "columns": ["trace_id", "payload_json", "logged_at"],
                    "results": []
                }
            return {"success": True, "results": [], "columns": [], "rows": []}

        adapter.execute = MagicMock(side_effect=mock_execute)
        sql = "bs.trace(SELECT * FROM b00command);"
        res = adapter.execute_debug(sql)
        assert res["success"] is True
        assert len(res["results"]) == 1
        trace_res = res["results"][0]
        assert trace_res["isTrace"] is True
        assert trace_res["columns"] == ["cmd_id", "cmd_name"]
        assert trace_res["rows"] == [["CMD01", "Open"]]
        assert trace_res["row_count"] == 1

    def test_function_invoked_debug_trace_collected(self):
        """Verify that when a function containing bs.trace() is created and then invoked by SELECT,
        the trace telemetry emitted during function execution is captured and ordered correctly."""
        from app.database.postgresql import PostgreSqlAdapter
        adapter = PostgreSqlAdapter({"database": "testdb"})
        adapter.connection = MagicMock()
        adapter.connection.closed = False

        trace_emitted = False

        def mock_execute(sql_query, **kwargs):
            nonlocal trace_emitted
            clean = " ".join(sql_query.split())
            if "FROM _ide_debug_trace_queue" in clean:
                if trace_emitted:
                    trace_emitted = False
                    return {
                        "success": True,
                        "rows": [["trace_1", json.dumps([{"amount": 100, "amount_total": 100}]), "2026-10-08 16:00:00"]],
                        "columns": ["trace_id", "payload_json", "logged_at"],
                        "results": []
                    }
                else:
                    return {"success": True, "rows": [], "columns": ["trace_id", "payload_json", "logged_at"], "results": []}
            elif "SELECT * FROM UFN_TEST()" in clean.upper():
                trace_emitted = True
                return {
                    "success": True,
                    "results": [{"columns": ["ufn_test"], "rows": [["ref1"]], "row_count": 1}],
                    "columns": ["ufn_test"],
                    "rows": [["ref1"]],
                    "row_count": 1
                }
            return {"success": True, "results": [], "columns": [], "rows": []}

        adapter.execute = MagicMock(side_effect=mock_execute)

        sql = """CREATE OR REPLACE FUNCTION ufn_test() RETURNS refcursor AS $function$
BEGIN
    UPDATE Tmp_CashReceipt SET amount = 0;
    bs.trace(SELECT * FROM Tmp_CashReceipt);
    OPEN _ref1 FOR SELECT FROM Tmp_CashReceipt;
    RETURN NEXT _ref1;
END;
$function$ LANGUAGE plpgsql;

SELECT * FROM ufn_test();"""

        res = adapter.execute_debug(sql)
        assert res["success"] is True
        assert len(res["trace_results"]) == 1
        assert res["trace_results"][0]["trace_id"] == "trace_1"
        assert res["trace_results"][0]["columns"] == ["amount", "amount_total"]
        assert res["trace_results"][0]["rows"] == [[100, 100]]

        # Ordered results: Trace #1 first, then Result #2 (function return)
        assert len(res["results"]) == 2
        assert res["results"][0]["isTrace"] is True
        assert res["results"][0]["title"].startswith("Trace #1")
        assert res["results"][0]["rows"] == [[100, 100]]

        assert res["results"][1]["isTrace"] is False
        assert res["results"][1]["title"] == "Result #2"
        assert res["results"][1]["columns"] == ["ufn_test"]
        assert res["results"][1]["rows"] == [["ref1"]]
