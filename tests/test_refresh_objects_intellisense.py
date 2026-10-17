# -*- coding: utf-8 -*-
"""
Tests for Refresh Objects & IntelliSense pipeline.
Verifies that newly created functions/objects are properly refreshed
and cached metadata is cleared across backend and adapters.
"""
from unittest.mock import MagicMock
from app.services.metadata_service import MetadataService
from app.api.metadata_api import MetadataApiMixin
from app.api.query_api import QueryApiMixin
from app.database.postgresql import PostgreSqlAdapter
from app.database.sqlserver import SqlServerAdapter
from app.database.sqlite import SqliteAdapter


class DummySession:
    def __init__(self, adapter):
        import threading
        self.adapter = adapter
        self.lock = threading.RLock()
        self.metadata_cache = {}
        self.config = {"type": getattr(adapter, "db_type", "sqlserver")}


class DummyMetadataApi(MetadataApiMixin, QueryApiMixin):
    def __init__(self, session):
        self._session = session
        self.owner_session_id = "test_owner"

    def _get_connection(self, connection_id):
        conn = MagicMock()
        conn.metadata_service = MetadataService(self._session)
        conn.adapter = self._session.adapter
        return conn


def test_metadata_service_invalidate_clears_intellisense_objects():
    adapter = MagicMock()
    adapter.get_intellisense_objects.return_value = [
        {"name": "fn_OldFunc", "schema": "dbo", "type": "function", "target_object": ""}
    ]
    session = DummySession(adapter)
    svc = MetadataService(session)

    # 1. Populate cache
    res1 = svc.get_intellisense_objects("TestDB", "dbo")
    assert len(res1) == 1
    assert res1[0]["name"] == "fn_OldFunc"
    assert "intellisense_objects::TestDB::dbo" in session.metadata_cache

    # 2. Simulate new function created in database
    adapter.get_intellisense_objects.return_value = [
        {"name": "fn_OldFunc", "schema": "dbo", "type": "function", "target_object": ""},
        {"name": "fn_NewCustomFunction", "schema": "dbo", "type": "function", "target_object": ""}
    ]

    # Without invalidation, cache still returns old function only
    cached = svc.get_intellisense_objects("TestDB", "dbo")
    assert len(cached) == 1

    # 3. Call invalidate with database
    svc.invalidate(database="TestDB")
    assert "intellisense_objects::TestDB::dbo" not in session.metadata_cache

    # 4. Next call returns newly added function immediately!
    res2 = svc.get_intellisense_objects("TestDB", "dbo")
    assert len(res2) == 2
    names = [x["name"] for x in res2]
    assert "fn_NewCustomFunction" in names


def test_refresh_metadata_api_mixin():
    adapter = MagicMock()
    session = DummySession(adapter)
    session.metadata_cache["intellisense_objects::MyDatabase::dbo"] = [{"name": "old_fn"}]
    session.metadata_cache["objects::MyDatabase::dbo::functions::::0"] = [{"name": "old_fn"}]

    api = DummyMetadataApi(session)
    result = api.refresh_metadata("conn_123", database="MyDatabase", schema="dbo")
    assert result["success"] is True
    # Cache cleared for MyDatabase
    assert "intellisense_objects::MyDatabase::dbo" not in session.metadata_cache
    assert "objects::MyDatabase::dbo::functions::::0" not in session.metadata_cache


def test_postgresql_adapter_all_schemas_intellisense_functions():
    adapter = PostgreSqlAdapter({'dbname': 'postgres', 'host': 'localhost'})
    adapter.execute = MagicMock()

    # When schema=None, queries all non-system schemas
    adapter.execute.return_value = {
        "rows": [
            ("fn_calculate_tax", "accounting", "function"),
            ("fn_user_status", "public", "function")
        ]
    }

    items = adapter.get_intellisense_objects(database="mydb", schema=None)
    # verify routines query was executed without hardcoding 'public'
    call_args = adapter.execute.call_args_list
    assert len(call_args) >= 2  # tv_query, routines_query
    routines_sql = call_args[1][0][0]
    assert "pg_catalog.pg_proc" in routines_sql
    assert "NOT IN ('pg_catalog', 'information_schema', 'pg_toast')" in routines_sql


def test_sqlite_adapter_get_intellisense_objects():
    adapter = SqliteAdapter({'path': ':memory:'})
    adapter.execute = MagicMock()
    adapter.execute.return_value = {
        "rows": [
            ("Users", "table"),
            ("ActiveUsers", "view")
        ]
    }
    items = adapter.get_intellisense_objects()
    assert len(items) == 2
    assert items[0]["name"] == "Users"
    assert items[0]["type"] == "table"
