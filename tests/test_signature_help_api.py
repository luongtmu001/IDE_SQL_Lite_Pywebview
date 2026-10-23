# -*- coding: utf-8 -*-
"""
tests/test_signature_help_api.py - Tests for backend parameter retrieval for Signature Help
Tests SQL Server and PostgreSQL adapters, /proc-params endpoint, and QueryApiMixin.
"""
from unittest.mock import MagicMock, patch
import pytest

from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter
from app.api.query_api import QueryApiMixin


class TestSqlServerParameterIntelliSense:
    """Tests for SqlServerAdapter.get_intellisense_parameters"""

    def test_sqlserver_parameter_formatting_and_direction(self):
        adapter = SqlServerAdapter({
            "server": "localhost",
            "database": "testdb",
            "username": "sa",
            "password": "pwd"
        })
        mock_execute = MagicMock(return_value={
            "rows": [
                # name, type_name, max_length, precision, scale, is_output, has_default, default_value
                ("@CustomerID", "int", 4, 10, 0, 0, 0, None),
                ("@CustomerName", "nvarchar", 100, 0, 0, 0, 1, "'N/A'"),
                ("@TotalAmount", "decimal", 9, 18, 2, 0, 0, None),
                ("@Comments", "varchar", -1, 0, 0, 0, 0, None),
                ("@NewId", "int", 4, 10, 0, 1, 0, None),
            ]
        })
        adapter.execute = mock_execute

        # Test with object_name
        params = adapter.get_intellisense_parameters(database="testdb", schema="dbo", object_name="usp_InsertOrder")
        assert len(params) == 5

        # Check @CustomerID
        assert params[0]["name"] == "@CustomerID"
        assert params[0]["data_type"] == "int"
        assert params[0]["is_output"] is False
        assert params[0]["direction"] == "IN"

        # Check @CustomerName: nvarchar(100) -> 100/2 = 50
        assert params[1]["name"] == "@CustomerName"
        assert params[1]["data_type"] == "nvarchar(50)"
        assert params[1]["default_value"] == "'N/A'"

        # Check @TotalAmount: decimal(18,2)
        assert params[2]["name"] == "@TotalAmount"
        assert params[2]["data_type"] == "decimal(18,2)"

        # Check @Comments: varchar(-1) -> varchar(MAX)
        assert params[3]["name"] == "@Comments"
        assert params[3]["data_type"] == "varchar(MAX)"

        # Check @NewId: is_output = True -> direction = OUT
        assert params[4]["name"] == "@NewId"
        assert params[4]["is_output"] is True
        assert params[4]["direction"] == "OUT"

    def test_sqlserver_accepts_name_kwarg(self):
        adapter = SqlServerAdapter({"server": "localhost", "database": "testdb"})
        adapter.execute = MagicMock(return_value={"rows": [
            ("@Param1", "varchar", 50, 0, 0, 0, 0, None)
        ]})
        params = adapter.get_intellisense_parameters(database="testdb", schema="dbo", name="usp_Test")
        assert len(params) == 1
        assert params[0]["name"] == "@Param1"
        assert params[0]["data_type"] == "varchar(50)"

    def test_sqlserver_returns_empty_on_missing_name(self):
        adapter = SqlServerAdapter({"server": "localhost", "database": "testdb"})
        assert adapter.get_intellisense_parameters() == []


class TestPostgresParameterIntelliSense:
    """Tests for PostgreSqlAdapter.get_intellisense_parameters"""

    def test_postgresql_parameter_modes_and_defaults(self):
        adapter = PostgreSqlAdapter({
            "host": "localhost",
            "database": "testdb",
            "username": "postgres",
            "password": "pwd"
        })
        mock_execute = MagicMock(return_value={
            "rows": [
                # parameter_name, data_type, parameter_mode, parameter_default, ordinal_position
                ("p_user_id", "integer", "IN", None, 1),
                ("p_email", "character varying", "IN", "'guest@example.com'::text", 2),
                ("p_status_out", "text", "OUT", None, 3),
                ("p_counter", "integer", "INOUT", "0", 4),
            ]
        })
        adapter.execute = mock_execute

        params = adapter.get_intellisense_parameters(database="testdb", schema="public", object_name="sp_create_user")
        assert len(params) == 4

        # p_user_id
        assert params[0]["name"] == "p_user_id"
        assert params[0]["data_type"] == "integer"
        assert params[0]["direction"] == "IN"
        assert params[0]["is_output"] is False

        # p_email default value
        assert params[1]["name"] == "p_email"
        assert params[1]["data_type"] == "character varying"
        assert params[1]["default_value"] == "'guest@example.com'::text"

        # p_status_out is_output
        assert params[2]["name"] == "p_status_out"
        assert params[2]["direction"] == "OUT"
        assert params[2]["is_output"] is True

        # p_counter INOUT
        assert params[3]["name"] == "p_counter"
        assert params[3]["direction"] == "INOUT"
        assert params[3]["is_output"] is True

    def test_postgresql_accepts_name_kwarg(self):
        adapter = PostgreSqlAdapter({"host": "localhost", "database": "testdb"})
        adapter.execute = MagicMock(return_value={"rows": [
            ("p_id", "integer", "IN", None, 1)
        ]})
        params = adapter.get_intellisense_parameters(database="testdb", schema="public", name="sp_test")
        assert len(params) == 1
        assert params[0]["name"] == "p_id"

    def test_postgresql_returns_empty_on_missing_name(self):
        adapter = PostgreSqlAdapter({"host": "localhost", "database": "testdb"})
        assert adapter.get_intellisense_parameters() == []


class TestProcParamsRoute:
    """Tests for POST /proc-params route"""

    def test_proc_params_validation_and_response(self):
        from flask import Flask
        from app.routes.query import query_bp

        app = Flask(__name__)
        app.register_blueprint(query_bp)

        client = app.test_client()

        # Missing connection_id
        res = client.post("/proc-params", json={"proc_name": "usp_test"})
        assert res.status_code == 400
        assert res.get_json()["success"] is False

        # Missing proc_name
        res = client.post("/proc-params", json={"connection_id": "conn-1"})
        assert res.status_code == 400

        # Successful retrieval mock
        mock_cm = MagicMock()
        mock_conn = MagicMock()
        mock_conn.metadata_service.get_intellisense_parameters.return_value = [
            {"name": "@p1", "data_type": "int", "is_output": False}
        ]
        mock_cm.get.return_value = mock_conn

        with patch("app.routes.query.get_connection_manager", return_value=mock_cm), \
             patch("app.routes.query.get_owner_session_id", return_value="desktop_user"):
            res = client.post("/proc-params", json={
                "connection_id": "conn-1",
                "database": "mydb",
                "schema": "dbo",
                "proc_name": "usp_test"
            })
            assert res.status_code == 200
            data = res.get_json()
            assert data["success"] is True
            assert len(data["params"]) == 1
            assert data["params"][0]["name"] == "@p1"


class TestQueryApiMixinProcParams:
    """Tests for QueryApiMixin.get_proc_params"""

    def test_query_api_get_proc_params(self):
        class DummyApi(QueryApiMixin):
            def __init__(self):
                self.conn = MagicMock()
                self.conn.metadata_service.get_intellisense_parameters.return_value = [
                    {"name": "@Param1", "data_type": "int"}
                ]

            def _get_connection(self, connection_id):
                return self.conn

        api = DummyApi()
        res = api.get_proc_params("conn-1", database="db", schema="dbo", proc_name="usp_Calc")
        assert res["success"] is True
        assert len(res["params"]) == 1
        assert res["params"][0]["name"] == "@Param1"

    def test_query_api_get_proc_params_not_found(self):
        class DummyApi(QueryApiMixin):
            def _get_connection(self, connection_id):
                return None

        api = DummyApi()
        res = api.get_proc_params("invalid-conn", proc_name="usp_Calc")
        assert res["success"] is False
        assert "not found" in res["error"]
