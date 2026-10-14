"""
Test Suite for Monaco SQL Syntax Check (SQL Server & PostgreSQL).
Validates batch splitting, zero-side-effects parser, line/col accuracy,
and the POST /api/query/syntax-check API endpoint.
Reference: .SKILL/sytax_check.md and syntax_check_monaco_plan.md
"""

try:
    import pytest
except ImportError:
    class _DummyPytest:
        @staticmethod
        def fixture(func):
            return func
        class mark:
            @staticmethod
            def skip(reason=""):
                def decorator(func):
                    return func
                return decorator
    pytest = _DummyPytest()
try:
    from app import create_app
except ImportError:
    create_app = None
from unittest.mock import MagicMock
from app.database.syntax import split_sqlserver_batches, validate_sql
from app.database.syntax.validator import validate_postgresql, validate_sql_server


class TestSqlServerBatchSplitter:
    """Tests for SQL Server GO batch splitting without naive split('GO')."""

    def test_single_batch(self):
        sql = "SELECT 1;\nSELECT 2;"
        batches = split_sqlserver_batches(sql)
        assert len(batches) == 1
        assert batches[0]["start_line"] == 1
        assert "SELECT 1;" in batches[0]["text"]

    def test_multiple_go_batches(self):
        sql = "SELECT 1;\nGO\nSELECT 2;\nGO\nSELECT 3;"
        batches = split_sqlserver_batches(sql)
        assert len(batches) == 3
        assert batches[0]["start_line"] == 1
        assert "SELECT 1;" in batches[0]["text"]
        assert batches[1]["start_line"] == 3
        assert "SELECT 2;" in batches[1]["text"]
        assert batches[2]["start_line"] == 5
        assert "SELECT 3;" in batches[2]["text"]

    def test_go_with_comments_and_counts(self):
        sql = "SELECT 1;\nGO -- batch end\nSELECT 2;\nGO 3\nSELECT 3;"
        batches = split_sqlserver_batches(sql)
        assert len(batches) == 3
        assert batches[0]["start_line"] == 1
        assert batches[1]["start_line"] == 3
        assert batches[2]["start_line"] == 5

    def test_ignore_go_in_string_literals(self):
        sql = "SELECT 'This is a string\nGO\nstill in string';\nGO\nSELECT 2;"
        batches = split_sqlserver_batches(sql)
        assert len(batches) == 2
        assert "still in string" in batches[0]["text"]
        assert batches[1]["start_line"] == 5

    def test_ignore_go_in_block_comments(self):
        sql = "/*\nGO\n*/\nSELECT 1;\nGO\nSELECT 2;"
        batches = split_sqlserver_batches(sql)
        assert len(batches) == 2
        assert batches[0]["start_line"] == 1
        assert "SELECT 1;" in batches[0]["text"]


class TestSqlServerValidation:
    """Tests for SQL Server syntax validation."""

    def test_valid_tsql(self):
        sql = "SELECT 1 AS num;\nSELECT * FROM sys.tables WHERE is_ms_shipped = 0;"
        diags = validate_sql_server(sql)
        assert diags == []

    def test_invalid_tsql_detected(self):
        sql = "SELECT FROM WHERE;"
        diags = validate_sql_server(sql)
        assert len(diags) > 0
        d = diags[0]
        assert d["severity"] == "error"
        assert d["code"] == "SQL_SYNTAX_ERROR"
        assert d["line"] == 1
        assert d["column"] > 0
        assert d["source"] in ("tsql", "sqlserver")

    def test_multiline_tsql_error_line(self):
        sql = "SELECT 1;\nSELECT 2;\nSELECT * FROM WHERE;"
        diags = validate_sql_server(sql)
        assert len(diags) > 0
        d = diags[0]
        assert d["line"] == 3

    def test_mock_live_connection_parseonly(self):
        """Simulate SQL Server ODBC cursor with SET PARSEONLY ON."""
        mock_cursor = MagicMock()
        # Simulate ODBC syntax error on execute
        mock_cursor.execute.side_effect = [
            None,  # SET PARSEONLY ON
            Exception(
                "[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Line 2: Incorrect syntax near 'WHERE'. (156)"
            ),
        ]
        mock_cursor.nextset.return_value = False

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        mock_session = MagicMock()
        mock_session.adapter.connection = mock_conn

        sql = "SELECT 1;\nSELECT * FROM WHERE;"
        diags = validate_sql_server(sql, connection_session=mock_session)
        assert len(diags) == 1
        assert diags[0]["line"] == 2
        assert diags[0]["token"] == "WHERE"
        assert "Incorrect syntax near 'WHERE'" in diags[0]["message"]
        # Verify SET PARSEONLY OFF was called in finally
        calls = [c[0][0] for c in mock_cursor.execute.call_args_list if c[0]]
        assert "SET PARSEONLY OFF" in calls

    def test_mock_live_connection_procedure_offset(self):
        """Verify procedure relative error line is correctly offset by procedure definition line."""
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = [
            None,  # SET PARSEONLY ON
            Exception(
                "[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Msg 156, Level 15, State 1, Procedure usp_TestProc, Line 5\r\n"
                "Line 5: Incorrect syntax near the keyword 'FORM'. (156)"
            ),
        ]
        mock_cursor.nextset.return_value = False

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        mock_session = MagicMock()
        mock_session.adapter.connection = mock_conn

        # 4 header lines before CREATE PROCEDURE (proc starts at line 5)
        # Line 5: CREATE PROCEDURE (proc line 1)
        # Line 6: AS (proc line 2)
        # Line 7: BEGIN (proc line 3)
        # Line 8:     SELECT 1 AS ID; (proc line 4)
        # Line 9:     SELECT * FORM MyTable; (proc line 5)
        sql = (
            "-- Comment Line 1\n"
            "-- Comment Line 2\n"
            "-- Comment Line 3\n"
            "\n"
            "CREATE PROCEDURE dbo.usp_TestProc\n"
            "AS\n"
            "BEGIN\n"
            "    SELECT 1 AS ID;\n"
            "    SELECT * FORM MyTable;\n"
            "END"
        )
        diags = validate_sql_server(sql, connection_session=mock_session)
        assert len(diags) == 1
        d = diags[0]
        # Must be Line 9 (exact line of error), NOT Line 5 (where proc starts)
        assert d["line"] == 9
        assert d["token"] == "FORM"
        assert d["column"] == 14
        assert d["end_column"] == 18
        assert "Procedure" not in d["message"]
        assert "Incorrect syntax near the keyword 'FORM'" in d["message"]

    def test_procedure_offline_validation_multiple_selects(self):
        """Offline validation inside a stored procedure correctly identifies faulty SELECT statement."""
        sql = (
            "CREATE PROCEDURE dbo.usp_TestOffline\n"
            "AS\n"
            "BEGIN\n"
            "    SELECT 1 AS ValidCol;\n"
            "    SELECT 2 AS SecondCol;\n"
            "    SELECT FROM InvalidTable;\n"
            "END"
        )
        diags = validate_sql_server(sql)
        assert len(diags) == 1
        d = diags[0]
        # Must target Line 6 (SELECT FROM InvalidTable), NOT Line 4 (first SELECT)!
        assert d["line"] == 6
        assert d["token"] == "SELECT"
        assert d["column"] == 5

    def test_mock_live_connection_try_catch_multiple_errors(self):
        """Verify dynamic TRY CATCH path detects exact line and multiple errors."""
        mock_cursor = MagicMock()
        mock_cursor.description = [("err_line",), ("err_msg",), ("err_num",)]
        # Simulate returning error on line 5 first pass, then error on line 7 second pass, then None (no more errors)
        mock_cursor.fetchall.side_effect = [
            [(5, "Incorrect syntax near 'FORM'.", 102)],
            [(7, "Incorrect syntax near 'FORM'.", 102)],
            [],
        ]

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        mock_session = MagicMock()
        mock_session.adapter.connection = mock_conn

        sql = (
            "CREATE PROCEDURE dbo.usp_Multi\n"
            "AS\n"
            "BEGIN\n"
            "    SELECT 1 AS ID;\n"
            "    SELECT * FORM Table1;\n"
            "    SELECT 2 AS Name;\n"
            "    SELECT * FORM Table2;\n"
            "END"
        )
        diags = validate_sql_server(sql, connection_session=mock_session)
        assert len(diags) == 2
        assert diags[0]["line"] == 5
        assert diags[0]["token"] == "FORM"
        assert diags[0]["column"] == 14
        assert diags[1]["line"] == 7
        assert diags[1]["token"] == "FORM"
        assert diags[1]["column"] == 14

    def test_mock_live_connection_odbc_no_line_fallback(self):
        """When ODBC returns error without 'Line N', validator locates token line instead of line 1."""
        mock_cursor = MagicMock()
        # Fail the dynamic check, forcing direct fallback
        mock_cursor.execute.side_effect = [
            Exception("EXEC not allowed"),
            None,  # SET PARSEONLY ON
            Exception("[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Incorrect syntax near 'FORM'. (102)"),
            None,  # SET PARSEONLY OFF
        ]
        mock_cursor.nextset.return_value = False

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        mock_session = MagicMock()
        mock_session.adapter.connection = mock_conn

        sql = (
            "CREATE PROCEDURE dbo.usp_NoLine\n"
            "AS\n"
            "BEGIN\n"
            "    SELECT 1 AS ID;\n"
            "    SELECT * FORM Table1;\n"
            "END"
        )
        diags = validate_sql_server(sql, connection_session=mock_session)
        assert len(diags) == 1
        # Must locate line 5 where 'FORM' actually is, NOT line 1!
        assert diags[0]["line"] == 5
        assert diags[0]["token"] == "FORM"
        assert diags[0]["column"] == 14

    def test_offline_validation_catches_all_errors(self):
        """Offline validator returns multiple diagnostics instead of stopping at the first one."""
        sql = (
            "CREATE PROCEDURE dbo.usp_MultiOffline\n"
            "AS\n"
            "BEGIN\n"
            "    SELECT col1, col2, FROM Table1;\n"
            "    SELECT 1 AS OK;\n"
            "    SELECT FROM Table2;\n"
            "END"
        )
        diags = validate_sql_server(sql)
        assert len(diags) >= 2
        lines = [d["line"] for d in diags]
        assert 4 in lines  # trailing comma on line 4
        assert 6 in lines  # empty select on line 6


class TestPostgresqlValidation:
    """Tests for PostgreSQL syntax validation."""

    def test_valid_postgres(self):
        sql = "SELECT id, name FROM users WHERE active = true ORDER BY id;"
        diags = validate_postgresql(sql)
        assert diags == []

    def test_valid_postgres_cte(self):
        sql = """
        WITH active_users AS (
            SELECT id, email FROM users WHERE is_active = true
        )
        SELECT * FROM active_users;
        """
        diags = validate_postgresql(sql)
        assert diags == []

    def test_invalid_postgres_syntax(self):
        sql = "SELECT * FROM;"
        diags = validate_postgresql(sql)
        assert len(diags) > 0
        d = diags[0]
        assert d["severity"] == "error"
        assert d["code"] == "SQL_SYNTAX_ERROR"
        assert d["line"] == 1

    def test_multiline_postgres_syntax(self):
        sql = "SELECT 1;\nSELECT (1 + 2;\nSELECT 3;"
        diags = validate_postgresql(sql)
        assert len(diags) > 0
        d = diags[0]
        assert d["line"] == 2

    def test_mock_live_postgres_statement_position(self):
        """Verify PostgreSQL statement_position is converted accurately to 1-based line and column."""
        sql = "SELECT 1 AS A;\nSELECT * FORM users;"
        # Character offset of 'FORM' is 25 (1-based), line 2, col 10
        mock_cursor = MagicMock()
        mock_err = Exception('syntax error at or near "FORM"')
        mock_diag = MagicMock()
        mock_diag.statement_position = "25"
        mock_diag.message_primary = 'syntax error at or near "FORM"'
        mock_err.diag = mock_diag

        mock_cursor.execute.side_effect = [
            None,  # BEGIN
            mock_err,  # execute query
            None,  # ROLLBACK
            None,  # outer finally ROLLBACK
        ]

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        mock_session = MagicMock()
        mock_session.adapter.connection = mock_conn

        diags = validate_postgresql(sql, connection_session=mock_session)
        assert len(diags) == 1
        d = diags[0]
        assert d["line"] == 2
        assert d["token"] == "FORM"
        assert d["column"] == 10
        assert d["end_column"] == 14
        assert d["source"] == "postgresql"

    def test_mock_live_postgres_procedure_validation(self):
        """Verify PostgreSQL procedure with error inside body has accurate line/col and zero side-effects."""
        sql = (
            "CREATE OR REPLACE PROCEDURE usp_test()\n"
            "LANGUAGE plpgsql\n"
            "AS $$\n"
            "BEGIN\n"
            "    SELECT 1;\n"
            "    SELECT * FORM users;\n"
            "END;\n"
            "$$;"
        )
        # Position of 'FORM' inside line 6:
        pos = sql.find("FORM") + 1
        mock_cursor = MagicMock()
        mock_err = Exception('syntax error at or near "FORM"')
        mock_diag = MagicMock()
        mock_diag.statement_position = str(pos)
        mock_diag.message_primary = 'syntax error at or near "FORM"'
        mock_err.diag = mock_diag

        mock_cursor.execute.side_effect = [
            None,  # BEGIN
            mock_err,
            None,  # ROLLBACK
            None,  # outer finally ROLLBACK
        ]

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        mock_session = MagicMock()
        mock_session.adapter.connection = mock_conn

        diags = validate_postgresql(sql, connection_session=mock_session)
        assert len(diags) == 1
        d = diags[0]
        assert d["line"] == 6
        assert d["token"] == "FORM"
        assert d["column"] == 14
        assert d["end_column"] == 18


class TestValidateSqlDispatcher:
    """Tests for main validate_sql function."""

    def test_empty_sql_returns_empty(self):
        assert validate_sql("") == []
        assert validate_sql("   \n\t  ") == []

    def test_dialect_dispatch(self):
        tsql_err = validate_sql("SELECT FROM WHERE;", dialect="sqlserver")
        assert len(tsql_err) > 0
        assert tsql_err[0]["source"] in ("tsql", "sqlserver")

        pg_err = validate_sql("SELECT * FROM;", dialect="postgresql")
        assert len(pg_err) > 0
        assert pg_err[0]["source"] in ("postgres", "postgresql")


class TestSyntaxCheckApi:
    """Tests for POST /api/query/syntax-check."""

    @pytest.fixture
    def client(self):
        app = create_app()
        app.config["TESTING"] = True
        with app.test_client() as client:
            yield client

    def test_api_empty_sql(self, client):
        res = client.post(
            "/api/query/syntax-check",
            json={"sql": "", "dialect": "sqlserver"},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["diagnostics"] == []

    def test_api_valid_sql(self, client):
        res = client.post(
            "/api/query/syntax-check",
            json={"sql": "SELECT 1;", "dialect": "sqlserver"},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["diagnostics"] == []

    def test_api_invalid_sql(self, client):
        res = client.post(
            "/api/query/syntax-check",
            json={"sql": "SELECT FROM WHERE;", "dialect": "sqlserver"},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert len(data["diagnostics"]) > 0
        d = data["diagnostics"][0]
        assert d["severity"] == "error"
        assert d["line"] == 1


class TestSyntaxCheckSettingsAndIntegration:
    """Tests for settings UI toggle and right-click context menu integration."""

    def test_template_contains_syntax_check_scripts(self):
        with open("templates/index.html", "r", encoding="utf-8") as f:
            html = f.read()
        assert "static/js/syntax-check/diagnostic-model.js" in html
        assert "static/js/syntax-check/position-mapper.js" in html
        assert "static/js/syntax-check/syntax-check-service.js" in html
        assert 'id="ide-btn-parse"' in html

    def test_settings_has_syntax_check_switch(self):
        with open("static/js/settings.js", "r", encoding="utf-8") as f:
            content = f.read()
        assert "syntaxCheck" in content
        assert "DEFAULT_SETTINGS" in content
        assert "SqlSyntaxCheckService.setEnabled" in content

    def test_editor_has_toggle_context_menu(self):
        with open("static/js/editor.js", "r", encoding="utf-8") as f:
            content = f.read()
        assert "sql-toggle-syntax-check" in content
        assert "SqlSyntaxCheckService.toggleEnabled" in content
        assert "SqlSyntaxCheckService.attachEditor" in content

    def test_query_binds_parse_button_and_shortcut(self):
        with open("static/js/query.js", "r", encoding="utf-8") as f:
            content = f.read()
        assert "ide-btn-parse" in content
        assert "checkSqlSyntax" in content

    def test_offline_structural_ast_checks(self):
        """Verify that offline parser detects missing column list and join without ON."""
        diags_empty_select = validate_sql("SELECT FROM users;")
        assert len(diags_empty_select) > 0
        assert diags_empty_select[0]["code"] == "SQL_SYNTAX_ERROR"

        diags_join_no_on = validate_sql("SELECT * FROM tbl1 INNER JOIN tbl2;")
        assert len(diags_join_no_on) > 0
        assert "ON clause" in diags_join_no_on[0]["message"]

        diags_standalone_select = validate_sql("SELECT")
        assert len(diags_standalone_select) > 0

    def test_frontend_syntax_check_service_offline_and_listeners(self):
        """Verify syntax-check-service.js does not require connectionId and listens to context/tab changes."""
        with open("static/js/syntax-check/syntax-check-service.js", "r", encoding="utf-8") as f:
            content = f.read()

        # Should not block on !connectionId
        assert "!sql || !sql.trim() || !connectionId" not in content
        assert "connection_id: connectionId || null" in content
        assert "ide-context-changed" in content
        assert "ide-tab-switched" in content

    def test_editor_has_render_validation_decorations(self):
        """Verify editor.js explicitly enables renderValidationDecorations for reliable squigglies."""
        with open("static/js/editor.js", "r", encoding="utf-8") as f:
            content = f.read()
        assert "renderValidationDecorations: 'on'" in content or 'renderValidationDecorations: "on"' in content

