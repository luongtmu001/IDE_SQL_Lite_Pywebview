from unittest.mock import MagicMock, patch
from app import create_app
from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter


def test_sqlserver_sequences_and_user_types():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.execute = MagicMock()

    # 1. list_objects for sequences
    adapter.execute.return_value = {
        "rows": [["dbo", "InvoiceSeq", 1001], ["dbo", "OrderSeq", 1002]]
    }
    seqs = adapter.list_objects("TestDB", "dbo", "sequences")
    assert len(seqs) == 2
    assert seqs[0]["name"] == "InvoiceSeq"
    assert seqs[1]["name"] == "OrderSeq"

    # Verify SQL query
    call_args = adapter.execute.call_args
    assert "sys.sequences" in call_args[0][0]
    assert call_args[1]["database"] == "TestDB"

    # Test singular "sequence"
    seqs_singular = adapter.list_objects("TestDB", "dbo", "sequence")
    assert len(seqs_singular) == 2

    # 2. list_objects for user_types
    adapter.execute.return_value = {
        "rows": [["dbo", "PhoneNumber", 257], ["dbo", "TaxCode", 258]]
    }
    types = adapter.list_objects("TestDB", "dbo", "user_types")
    assert len(types) == 2
    assert types[0]["name"] == "PhoneNumber"
    assert types[1]["name"] == "TaxCode"

    call_args = adapter.execute.call_args
    assert "sys.types" in call_args[0][0]
    assert "is_user_defined = 1" in call_args[0][0]

    # 3. get_object_definition for sequence
    adapter.execute.return_value = {
        "rows": [["CREATE SEQUENCE [dbo].[InvoiceSeq] AS INT START WITH 1 INCREMENT BY 1;"]]
    }
    ddl = adapter.get_object_definition("TestDB", "dbo", "InvoiceSeq", "sequence")
    assert "CREATE SEQUENCE" in ddl
    assert "InvoiceSeq" in ddl

    # 4. get_object_definition for user_type
    adapter.execute.return_value = {
        "rows": [["CREATE TYPE [dbo].[PhoneNumber] FROM varchar(20) NOT NULL;"]]
    }
    ddl = adapter.get_object_definition("TestDB", "dbo", "PhoneNumber", "user_type")
    assert "CREATE TYPE" in ddl
    assert "PhoneNumber" in ddl


def test_postgresql_sequences_and_user_types():
    adapter = PostgreSqlAdapter({'username': 'postgres', 'password': 'pw', 'host': 'localhost', 'port': 5432})
    adapter.execute = MagicMock()

    # 1. list_objects for sequences
    adapter.execute.return_value = {
        "rows": [["public", "user_id_seq", 5001]]
    }
    seqs = adapter.list_objects("appdb", "public", "sequences")
    assert len(seqs) == 1
    assert seqs[0]["name"] == "user_id_seq"

    call_args = adapter.execute.call_args
    assert "relkind = 'S'" in call_args[0][0]

    # 2. list_objects for user_types
    adapter.execute.return_value = {
        "rows": [["public", "order_status", 5002]]
    }
    types = adapter.list_objects("appdb", "public", "user_types")
    assert len(types) == 1
    assert types[0]["name"] == "order_status"

    call_args = adapter.execute.call_args
    assert "pg_type" in call_args[0][0]
    assert "typtype IN ('c', 'd', 'e')" in call_args[0][0]

    # 3. get_object_definition for sequence
    adapter.execute.return_value = {
        "rows": [["CREATE SEQUENCE public.user_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 NO CYCLE;"]]
    }
    ddl = adapter.get_object_definition("appdb", "public", "user_id_seq", "sequence")
    assert "CREATE SEQUENCE" in ddl
    assert "user_id_seq" in ddl

    # 4. get_object_definition for user_type
    adapter.execute.return_value = {
        "rows": [["CREATE TYPE public.order_status AS ENUM ('pending', 'completed', 'cancelled');"]]
    }
    ddl = adapter.get_object_definition("appdb", "public", "order_status", "user_type")
    assert "CREATE TYPE" in ddl
    assert "order_status" in ddl


def test_metadata_api_sequences_and_types():
    app = create_app()
    app.config.update(TESTING=True)

    with app.test_client() as client:
        with patch('app.routes.metadata.get_connection') as mock_get_conn:
            mock_conn = MagicMock()
            mock_conn.metadata_service.list_objects.side_effect = lambda db, sch, obj_type, search=None: (
                [{"name": "seq1", "schema": sch}] if obj_type == "sequences" else
                [{"name": "udt1", "schema": sch}] if obj_type == "user_types" else []
            )
            mock_conn.metadata_service.get_object_definition.return_value = "CREATE SEQUENCE dbo.seq1 START WITH 1;"
            mock_get_conn.return_value = mock_conn

            # Test sequences API
            res = client.get('/api/metadata/test-conn/objects?database=mydb&schema=dbo&type=sequences')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert res.json['items'][0]['name'] == 'seq1'

            # Test user_types API
            res = client.get('/api/metadata/test-conn/objects?database=mydb&schema=dbo&type=user_types')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert res.json['items'][0]['name'] == 'udt1'

            # Test definition API
            res = client.get('/api/metadata/test-conn/definition?database=mydb&schema=dbo&name=seq1&type=sequence')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert "CREATE SEQUENCE" in res.json['definition']
