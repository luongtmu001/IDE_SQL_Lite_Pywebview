"""
Tests for Phase 4: Quoting integration and metadata fixes in sqlserver.py.
Verifies quote_ident on db_prefix, get_table_design_metadata, and get_supported_types.
"""
import pytest
from unittest.mock import MagicMock
from app.database.sqlserver import SqlServerAdapter


def test_sqlserver_db_prefix_escapes_brackets():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    executed_queries = []

    def mock_execute(sql, params=None, database=None):
        executed_queries.append(sql)
        return {"rows": []}

    adapter.execute = mock_execute

    # Database with bracket: "Test]Db"
    adapter.list_schemas(database="Test]Db")
    assert any("[Test]]Db]" in q for q in executed_queries)


def test_get_table_design_metadata_no_limit_argument_error():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})

    def mock_execute(sql, params=None, database=None):
        if "sys.tables o" in sql:
            return {"rows": [(123,)]}
        elif "sys.columns c" in sql:
            return {"rows": [
                (1, "Id", "int", 4, 10, 0, 0, 1, 1, 1, None, None, 1, "PK Description", False, "sys", "int", False, "PK_Customer", None),
                (2, "Name", "nvarchar", 100, 0, 0, 1, 0, 1, 1, "('guest')", "SQL_Latin1_General_CP1_CI_AS", 0, None, False, "sys", "nvarchar", False, None, "DF_Customer_Name")
            ]}
        return {"rows": []}

    adapter.execute = mock_execute
    meta = adapter.get_table_design_metadata("TestDb", "dbo", "Customer")
    assert meta is not None
    assert meta["table"] == "Customer"
    assert len(meta["columns"]) == 2
    assert meta["columns"][0]["pk_name"] == "PK_Customer"
    assert meta["columns"][1]["default_constraint_name"] == "DF_Customer_Name"
    assert meta.get("pk_name") == "PK_Customer"


def test_get_supported_types_no_limit_argument_error():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})

    def mock_execute(sql, params=None, database=None):
        if "sys.types" in sql:
            return {"rows": [("dbo", "phonenumber"), ("dbo", "zipcode")]}
        return {"rows": []}

    adapter.execute = mock_execute
    res = adapter.get_supported_types(database="SalesDB")
    assert "user_types" in res
    assert "[dbo].[phonenumber]" in res["user_types"]
    assert "[dbo].[zipcode]" in res["user_types"]
