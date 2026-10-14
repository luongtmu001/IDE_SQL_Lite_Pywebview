from unittest.mock import MagicMock
from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter
from app.services.metadata_service import MetadataService


def test_sqlserver_metadata_limit_fix():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.execute = MagicMock()

    # 1. list_objects with 1500 items returns all 1500 items and passes limit=0
    adapter.execute.return_value = {
        "rows": [["dbo", f"Table_{i}", i] for i in range(1500)]
    }
    items = adapter.list_objects("TestDb", "dbo", "tables")
    assert len(items) == 1500
    call_kwargs = adapter.execute.call_args[1]
    assert call_kwargs.get("limit") == 0
    assert call_kwargs.get("database") == "TestDb"

    # Custom limit passed
    adapter.list_objects("TestDb", "dbo", "tables", limit=200)
    call_kwargs = adapter.execute.call_args[1]
    assert call_kwargs.get("limit") == 200

    # 2. list_databases passes limit=0
    adapter.execute.return_value = {"rows": [["db1", "ONLINE"], ["db2", "ONLINE"]]}
    adapter.list_databases()
    assert adapter.execute.call_args[1].get("limit") == 0

    # 3. list_schemas passes limit=0
    adapter.execute.return_value = {"rows": [["dbo"]]}
    adapter.list_schemas("TestDb")
    assert adapter.execute.call_args[1].get("limit") == 0

    # 4. list_object_children columns passes limit=0
    adapter.execute.side_effect = [
        {"rows": [[101]]}, # obj_res
        {"rows": [[f"col_{i}", "int", 4, 1] for i in range(1200)]} # col_res
    ]
    cols = adapter.list_object_children("TestDb", "dbo", "Table_1", "tables", "columns")
    assert len(cols) == 1200
    assert adapter.execute.call_args[1].get("limit") == 0

    # 5. get_foreign_keys passes limit=0
    adapter.execute.side_effect = None
    adapter.execute.return_value = {"rows": []}
    adapter.get_foreign_keys("TestDb", "dbo", "Table_1")
    assert adapter.execute.call_args[1].get("limit") == 0


def test_postgresql_metadata_limit_fix():
    adapter = PostgreSqlAdapter({'host': 'localhost', 'user': 'postgres'})
    adapter.execute = MagicMock()

    # 1. list_objects with 1500 items returns all 1500 items and passes limit=0
    adapter.execute.return_value = {
        "rows": [["public", f"table_{i}", i] for i in range(1500)]
    }
    items = adapter.list_objects("testdb", "public", "tables")
    assert len(items) == 1500
    call_kwargs = adapter.execute.call_args[1]
    assert call_kwargs.get("limit") == 0

    # Custom limit
    adapter.list_objects("testdb", "public", "tables", limit=300)
    assert adapter.execute.call_args[1].get("limit") == 300

    # 2. list_databases passes limit=0
    adapter.execute.return_value = {"rows": [["db1", True]]}
    adapter.list_databases()
    assert adapter.execute.call_args[1].get("limit") == 0

    # 3. list_schemas passes limit=0
    adapter.execute.return_value = {"rows": [["public"]]}
    adapter.list_schemas("testdb")
    assert adapter.execute.call_args[1].get("limit") == 0

    # 4. get_foreign_keys passes limit=0
    adapter.execute.return_value = {"rows": []}
    adapter.get_foreign_keys("testdb", "public", "table_1")
    assert adapter.execute.call_args[1].get("limit") == 0


def test_metadata_service_limit_caching():
    class DummySession:
        def __init__(self):
            self.metadata_cache = {}
            import threading
            self.lock = threading.Lock()
            self.adapter = MagicMock()

    session = DummySession()
    service = MetadataService(session)

    session.adapter.list_objects.return_value = [{"name": "t1"}]

    # Call with default limit=0
    res1 = service.list_objects("db", "dbo", "tables")
    session.adapter.list_objects.assert_called_with("db", "dbo", "tables", None, limit=0)
    assert "objects::db::dbo::tables::::0" in session.metadata_cache

    # Call with custom limit=100 creates separate cache entry
    session.adapter.list_objects.return_value = [{"name": "t1_limited"}]
    res2 = service.list_objects("db", "dbo", "tables", limit=100)
    session.adapter.list_objects.assert_called_with("db", "dbo", "tables", None, limit=100)
    assert "objects::db::dbo::tables::::100" in session.metadata_cache


if __name__ == "__main__":
    test_sqlserver_metadata_limit_fix()
    test_postgresql_metadata_limit_fix()
    test_metadata_service_limit_caching()
    print("ALL METADATA LIMIT FIX TESTS PASSED SUCCESSFULLY!")
