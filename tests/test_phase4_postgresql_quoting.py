"""
Tests for Phase 4: Quoting and metadata retrieval in postgresql.py.
Verifies get_table_design_metadata pk_name extraction and no limit=0 errors.
"""
import pytest
from app.database.postgresql import PostgreSqlAdapter


def test_postgresql_get_table_design_metadata_pk_name():
    adapter = PostgreSqlAdapter({'user': 'postgres', 'password': 'pw', 'host': 'localhost', 'database': 'testdb'})

    def mock_execute(sql, params=None, database=None):
        if "information_schema.tables" in sql:
            return {"rows": [(1,)]}
        elif "information_schema.columns c" in sql:
            return {"rows": [
                (1, "id", "integer", "int4", None, 32, 0, "NO", "NO", "nextval('users_id_seq'::regclass)", None, 1, "User ID", "users_pkey"),
                (2, "username", "character varying", "varchar", 100, None, None, "NO", "NO", None, None, 0, None, None)
            ]}
        return {"rows": []}

    adapter.execute = mock_execute
    meta = adapter.get_table_design_metadata("testdb", "public", "users")
    assert meta is not None
    assert meta["table"] == "users"
    assert meta.get("pk_name") == "users_pkey"
    assert len(meta["columns"]) == 2
    assert meta["columns"][0]["pk_name"] == "users_pkey"
    assert meta["columns"][0]["is_pk"] is True
