from unittest.mock import MagicMock
from app.database.sqlserver import SqlServerAdapter


def test_sqlserver_list_objects_synonyms():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.execute = MagicMock()

    # 1. Mock rows returned from sys.synonyms
    adapter.execute.return_value = {
        "rows": [
            ["dbo", "CustomerSyn", 501, "[OtherDb].[dbo].[Customer]"],
            ["dbo", "OrderSyn", 502, "[OtherDb].[dbo].[Orders]"]
        ]
    }

    synonyms = adapter.list_objects("TestDb", "dbo", "synonyms")
    assert len(synonyms) == 2
    assert synonyms[0]["name"] == "CustomerSyn"
    assert synonyms[0]["schema"] == "dbo"
    assert synonyms[0]["id"] == 501
    assert synonyms[0]["base_object_name"] == "[OtherDb].[dbo].[Customer]"
    assert synonyms[1]["name"] == "OrderSyn"

    # Verify SQL query checks sys.synonyms and sys.schemas
    call_args = adapter.execute.call_args
    assert "sys.synonyms" in call_args[0][0]
    assert "sys.schemas" in call_args[0][0]
    assert call_args[1]["database"] == "TestDb"

    # 2. Singular "synonym"
    syn_singular = adapter.list_objects("TestDb", "dbo", "synonym")
    assert len(syn_singular) == 2


def test_sqlserver_list_objects_synonyms_with_search():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.execute = MagicMock()
    adapter.execute.return_value = {
        "rows": [["dbo", "CustomerSyn", 501, "[OtherDb].[dbo].[Customer]"]]
    }

    synonyms = adapter.list_objects("TestDb", "dbo", "synonyms", search="Customer")
    assert len(synonyms) == 1
    call_args = adapter.execute.call_args
    sql = call_args[0][0]
    params = call_args[0][1]
    assert "LIKE ?" in sql
    assert "%Customer%" in params


def test_sqlserver_get_object_definition_synonym():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.execute = MagicMock()

    expected_ddl = "CREATE SYNONYM [dbo].[CustomerSyn]\r\nFOR [OtherDb].[dbo].[Customer];"
    adapter.execute.return_value = {
        "rows": [[expected_ddl]]
    }

    ddl = adapter.get_object_definition("TestDb", "dbo", "CustomerSyn", "synonym")
    assert ddl == expected_ddl
    assert "CREATE SYNONYM" in ddl
    assert "[dbo].[CustomerSyn]" in ddl
    assert "FOR [OtherDb].[dbo].[Customer]" in ddl


def test_sqlserver_get_object_definition_synonym_secondary_fallback():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.execute = MagicMock()

    # Suppose first two queries fail/empty and raw metadata query returns columns: schema, name, base_object_name
    def mock_exec(sql, params=None, database=None):
        if "QUOTENAME" in sql:
            return {"rows": []}
        return {
            "rows": [["sales", "Item]Special", "[RemoteServer].[Warehouse].[dbo].[Items]"]]
        }

    adapter.execute.side_effect = mock_exec
    ddl = adapter.get_object_definition("TestDb", "sales", "Item]Special", "synonym")
    assert "CREATE SYNONYM [sales].[Item]]Special]" in ddl
    assert "FOR [RemoteServer].[Warehouse].[dbo].[Items];" in ddl
