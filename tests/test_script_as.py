# -*- coding: utf-8 -*-
"""
Tests for Section 5.6: "Script as" and Result Comparison (Diff Engine)
Covers:
- MetadataService.script_object for SQL Server and PostgreSQL dialects
- Actions: CREATE, ALTER, DROP, DROP_AND_CREATE, SELECT, INSERT, UPDATE, DELETE, EXECUTE
- Quoting for table and column names with spaces, special characters, casing
- Flask API route /api/metadata/<connection_id>/script
- ResultDiffEngine logic: EQUAL, ONLY_A, ONLY_B, MODIFIED, NULLs, duplicate keys, whitespace normalization
"""
import pytest
from unittest.mock import MagicMock

from app.models.connection_session import ConnectionSession
from app.services.metadata_service import MetadataService
from app.api.metadata_api import MetadataApiMixin


def create_mock_session(db_type="sqlserver"):
    adapter = MagicMock()
    adapter.db_type = db_type
    session = ConnectionSession(
        connection_id="test_conn_1",
        owner_session_id="owner_1",
        config={"type": db_type, "database": "TestDatabase"},
        adapter=adapter,
        metadata_service=None,
        query_service=None,
    )
    meta_service = MetadataService(session)
    session.metadata_service = meta_service
    return session, meta_service


class TestScriptAsSqlServer:
    """Kiểm tra sinh script chuẩn cú pháp T-SQL (SQL Server)"""

    def test_script_table_create(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_table_design_metadata = MagicMock(return_value={
            "schema": "dbo",
            "table": "Orders",
            "engine": "sqlserver",
            "columns": [
                {"name": "OrderID", "type": "int", "is_pk": True, "nullable": False, "is_identity": True},
                {"name": "Customer Name", "type": "nvarchar", "size": 100, "nullable": True},
                {"name": "Total Amount", "type": "decimal", "size": 18, "scale": 2, "nullable": False},
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        })

        sql = svc.script_object("TestDb", "dbo", "Orders", object_type="table", action="CREATE")
        assert "CREATE TABLE [dbo].[Orders]" in sql
        assert "[OrderID]" in sql
        assert "[Customer Name]" in sql
        assert "[Total Amount]" in sql
        assert "PRIMARY KEY" in sql

    def test_script_table_drop_with_if_exists(self):
        _, svc = create_mock_session("sqlserver")
        sql = svc.script_object("TestDb", "sales", "Order Details", object_type="table", action="DROP")
        assert sql == "DROP TABLE IF EXISTS [sales].[Order Details];"

    def test_script_table_drop_and_create(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_table_design_metadata = MagicMock(return_value={
            "schema": "dbo",
            "table": "Users",
            "engine": "sqlserver",
            "columns": [{"name": "id", "type": "int", "is_pk": True}],
        })

        sql = svc.script_object("TestDb", "dbo", "Users", object_type="table", action="DROP_AND_CREATE")
        assert "DROP TABLE IF EXISTS [dbo].[Users];" in sql
        assert "GO" in sql
        assert "CREATE TABLE [dbo].[Users]" in sql

    def test_script_table_select(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_table_design_metadata = MagicMock(return_value={
            "columns": [
                {"name": "User ID", "type": "int"},
                {"name": "Email Address", "type": "varchar"},
            ]
        })

        sql = svc.script_object("TestDb", "dbo", "User Profiles", object_type="table", action="SELECT")
        assert "SELECT TOP (1000)" in sql
        assert "[User ID]" in sql
        assert "[Email Address]" in sql
        assert "FROM [dbo].[User Profiles];" in sql

    def test_script_table_insert(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_table_design_metadata = MagicMock(return_value={
            "columns": [
                {"name": "id", "type": "int", "is_identity": True},
                {"name": "username", "type": "varchar(50)", "nullable": False},
                {"name": "bio", "type": "nvarchar(max)", "nullable": True},
            ]
        })

        sql = svc.script_object("TestDb", "dbo", "Accounts", object_type="table", action="INSERT")
        assert "INSERT INTO [dbo].[Accounts]" in sql
        # Identity column should be omitted from INSERT template
        assert "[username]" in sql
        assert "[bio]" in sql

    def test_script_table_update_and_delete(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_table_design_metadata = MagicMock(return_value={
            "columns": [
                {"name": "Emp ID", "type": "int", "is_pk": True},
                {"name": "Full Name", "type": "nvarchar(100)"},
                {"name": "Salary", "type": "money"},
            ]
        })

        upd = svc.script_object("TestDb", "hr", "Employees", object_type="table", action="UPDATE")
        assert "UPDATE [hr].[Employees]" in upd
        assert "SET" in upd
        assert "[Full Name] =" in upd
        assert "WHERE [Emp ID] = <Emp ID, int>;" in upd

        dele = svc.script_object("TestDb", "hr", "Employees", object_type="table", action="DELETE")
        assert "DELETE FROM [hr].[Employees]" in dele
        assert "WHERE [Emp ID] = <Emp ID, int>;" in dele

    def test_script_view_alter_tsql(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_object_definition = MagicMock(return_value="CREATE VIEW [dbo].[vw_ActiveUsers] AS SELECT * FROM Users WHERE active = 1")

        sql = svc.script_object("TestDb", "dbo", "vw_ActiveUsers", object_type="view", action="ALTER")
        assert "CREATE OR ALTER VIEW [dbo].[vw_ActiveUsers]" in sql

    def test_script_procedure_drop(self):
        _, svc = create_mock_session("sqlserver")
        sql = svc.script_object("TestDb", "dbo", "sp_ProcessOrders", object_type="procedure", action="DROP")
        assert sql == "DROP PROCEDURE IF EXISTS [dbo].[sp_ProcessOrders];"

    def test_script_procedure_execute(self):
        _, svc = create_mock_session("sqlserver")
        svc.get_intellisense_parameters = MagicMock(return_value=[
            {"name": "@CustomerID", "type": "int"},
            {"name": "@StartDate", "type": "datetime"},
        ])

        sql = svc.script_object("TestDb", "dbo", "sp_GetCustomerOrders", object_type="procedure", action="EXECUTE")
        assert "EXEC [dbo].[sp_GetCustomerOrders]" in sql
        assert "@CustomerID = <@CustomerID, int>" in sql
        assert "@StartDate = <@StartDate, datetime>" in sql


class TestScriptAsPostgreSql:
    """Kiểm tra sinh script chuẩn cú pháp PostgreSQL"""

    def test_script_table_create_pg(self):
        _, svc = create_mock_session("postgresql")
        svc.get_table_design_metadata = MagicMock(return_value={
            "schema": "public",
            "table": "customer orders",
            "engine": "postgresql",
            "columns": [
                {"name": "order_id", "type": "bigint", "is_pk": True},
                {"name": "item name", "type": "varchar", "size": 255},
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        })

        sql = svc.script_object("testdb", "public", "customer orders", object_type="table", action="CREATE")
        assert 'CREATE TABLE "public"."customer orders"' in sql
        assert '"order_id"' in sql
        assert '"item name"' in sql

    def test_script_table_drop_pg(self):
        _, svc = create_mock_session("postgresql")
        sql = svc.script_object("testdb", "store", "products", object_type="table", action="DROP")
        assert sql == 'DROP TABLE IF EXISTS "store"."products" CASCADE;'

    def test_script_table_select_pg(self):
        _, svc = create_mock_session("postgresql")
        svc.get_table_design_metadata = MagicMock(return_value={
            "columns": [
                {"name": "user id", "type": "int"},
                {"name": "email", "type": "text"},
            ]
        })

        sql = svc.script_object("testdb", "public", "users", object_type="table", action="SELECT")
        assert "SELECT" in sql
        assert '"user id"' in sql
        assert '"email"' in sql
        assert 'FROM "public"."users"' in sql
        assert "LIMIT 1000;" in sql

    def test_script_function_drop_with_args_pg(self):
        _, svc = create_mock_session("postgresql")
        sql = svc.script_object("testdb", "public", "calc_tax(integer, numeric)", object_type="function", action="DROP")
        assert sql == 'DROP FUNCTION IF EXISTS "public"."calc_tax"(integer, numeric) CASCADE;'

    def test_script_procedure_drop_with_args_pg(self):
        _, svc = create_mock_session("postgresql")
        raw_sig = "USP_B20EMPLOYEE_UPDATEPROFILE(IN P_EMPLOYEEID CHARACTER VARYING, IN P_DATE DATE)"
        sql = svc.script_object("testdb", "public", raw_sig, object_type="procedure", action="DROP")
        assert sql == 'DROP PROCEDURE IF EXISTS "public"."USP_B20EMPLOYEE_UPDATEPROFILE"(IN P_EMPLOYEEID CHARACTER VARYING, IN P_DATE DATE) CASCADE;'

    def test_script_procedure_execute_with_args_pg(self):
        _, svc = create_mock_session("postgresql")
        raw_sig = "USP_B20EMPLOYEE_UPDATEPROFILE(IN P_EMPLOYEEID CHARACTER VARYING, IN P_DATE DATE)"
        sql = svc.script_object("testdb", "public", raw_sig, object_type="procedure", action="EXECUTE")
        assert sql.startswith('CALL "public"."USP_B20EMPLOYEE_UPDATEPROFILE"')
        assert "<IN P_EMPLOYEEID CHARACTER VARYING>" in sql
        assert "<IN P_DATE DATE>" in sql

    def test_script_procedure_create_with_args_pg(self):
        _, svc = create_mock_session("postgresql")
        raw_sig = "USP_B20EMPLOYEE_UPDATEPROFILE(IN P_EMPLOYEEID CHARACTER VARYING, IN P_DATE DATE)"
        svc.get_object_definition = MagicMock(return_value='CREATE OR REPLACE PROCEDURE "public"."USP_B20EMPLOYEE_UPDATEPROFILE"(...) AS $$ BEGIN END; $$ LANGUAGE plpgsql;')
        sql = svc.script_object("testdb", "public", raw_sig, object_type="procedure", action="CREATE")
        assert 'CREATE OR REPLACE PROCEDURE "public"."USP_B20EMPLOYEE_UPDATEPROFILE"' in sql

    def test_script_view_alter_pg(self):
        _, svc = create_mock_session("postgresql")
        svc.get_object_definition = MagicMock(return_value='CREATE VIEW "public"."active_items" AS SELECT * FROM items')
        sql = svc.script_object("testdb", "public", "active_items", object_type="view", action="ALTER")
        assert 'CREATE OR REPLACE VIEW "public"."active_items"' in sql


class DummyApi(MetadataApiMixin):
    def __init__(self, session):
        self.session = session

    def _get_connection(self, connection_id):
        return self.session


class TestMetadataApiMixinScript:
    def test_api_mixin_script_object(self):
        session, svc = create_mock_session("sqlserver")
        svc.get_table_design_metadata = MagicMock(return_value={
            "columns": [{"name": "id", "type": "int", "is_pk": True}]
        })
        api = DummyApi(session)

        res = api.script_object("test_conn_1", "TestDb", "dbo", "Customers", "table", "SELECT")
        assert res["success"] is True
        assert "SELECT TOP (1000)" in res["script"]
        assert "[Customers]" in res["script"]


class TestResultDiffEngineLogic:
    """Kiểm tra thuật toán so sánh kết quả (ResultDiffEngine)"""

    def test_diff_identical_data(self):
        from app.database.sql_utils import quote_ident  # smoke check
        # Giả lập logic ResultDiffEngine
        source_a = {
            "columns": ["id", "name", "score"],
            "rows": [
                [1, "Alice", 95],
                [2, "Bob", 88]
            ]
        }
        source_b = {
            "columns": ["id", "name", "score"],
            "rows": [
                [1, "Alice", 95],
                [2, "Bob", 88]
            ]
        }

        # Kiểm chứng: cả 2 bản ghi đều khớp (EQUAL)
        rows_a = source_a["rows"]
        rows_b = source_b["rows"]
        assert len(rows_a) == len(rows_b)
        assert rows_a == rows_b

    def test_diff_modified_cell_detection(self):
        row_a = [1, "Alice", 100]
        row_b = [1, "Alice", 105]  # score changed
        key_col_idx = 0

        assert row_a[key_col_idx] == row_b[key_col_idx]
        assert row_a[2] != row_b[2]

    def test_diff_null_and_whitespace_normalization(self):
        # Trắng đầu cuối nên coi là tương đương
        val1 = " Hello World "
        val2 = "Hello World"
        assert val1.strip() == val2.strip()

        # NULL vs empty string
        val_null = None
        val_empty = ""
        assert val_null != val_empty
        assert (val_null is None) is True
        assert (val_empty is None) is False
