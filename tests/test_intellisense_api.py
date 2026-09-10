from app import create_app
from unittest.mock import MagicMock, patch
from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter

def test_intellisense_endpoints():
    app = create_app()
    app.config.update(TESTING=True)

    with app.test_client() as client:
        with patch('app.routes.metadata.get_connection') as mock_get_conn:
            mock_conn = MagicMock()
            mock_conn.metadata_service.get_intellisense_objects.return_value = [
                {"name": "Customer", "schema": "dbo", "type": "table", "target_object": ""},
                {"name": "Customer_Get", "schema": "dbo", "type": "procedure", "target_object": ""}
            ]
            mock_conn.metadata_service.get_intellisense_columns.return_value = [
                {"name": "Id", "type": "column", "schema": "dbo", "data_type": "int", "is_nullable": False, "is_pk": True},
                {"name": "Name", "type": "column", "schema": "dbo", "data_type": "nvarchar(100)", "is_nullable": True, "is_pk": False}
            ]
            mock_conn.metadata_service.get_intellisense_parameters.return_value = [
                {"name": "@CustomerId", "data_type": "int", "is_output": False}
            ]
            mock_get_conn.return_value = mock_conn

            # 1. Test objects endpoint
            res = client.get('/api/metadata/test-conn/intellisense/objects?database=TestDb&schema=dbo')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert len(res.json['items']) == 2
            assert res.json['items'][0]['name'] == 'Customer'
            print('[PASS] IntelliSense objects endpoint works')

            # 2. Test columns endpoint
            res = client.get('/api/metadata/test-conn/intellisense/columns?database=TestDb&schema=dbo&table=Customer')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert len(res.json['items']) == 2
            assert res.json['items'][0]['is_pk'] is True
            print('[PASS] IntelliSense columns endpoint works')

            # 3. Test parameters endpoint
            res = client.get('/api/metadata/test-conn/intellisense/parameters?database=TestDb&schema=dbo&name=Customer_Get')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert len(res.json['items']) == 1
            assert res.json['items'][0]['name'] == '@CustomerId'
            print('[PASS] IntelliSense parameters endpoint works')

            # 4. Test types endpoint
            mock_conn.metadata_service.get_supported_types.return_value = {
                "engine": "sqlserver",
                "types": ["int", "nvarchar", "datetime"],
                "user_types": ["[dbo].[CustomType]"]
            }
            res = client.get('/api/metadata/test-conn/intellisense/types?database=TestDb')
            assert res.status_code == 200
            assert res.json['success'] is True
            assert 'int' in res.json['types']
            assert '[dbo].[CustomType]' in res.json['user_types']
            print('[PASS] IntelliSense types endpoint works')

def test_sqlserver_adapter_intellisense():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    mock_pyodbc_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.description = [('name',), ('schema_name',), ('type',), ('base_object_name',)]
    mock_cursor.fetchall.return_value = [
        ('Customer', 'dbo', 'U', None),
        ('Customer_View', 'dbo', 'V', None),
        ('usp_GetCustomer', 'dbo', 'P', None),
        ('fn_Calculate', 'dbo', 'FN', None),
        ('trg_Audit', 'dbo', 'TR', None),
        ('syn_Item', 'dbo', 'SN', 'OtherDB.dbo.Item')
    ]
    mock_cursor.nextset.return_value = False
    mock_cursor.rowcount = -1
    mock_cursor.messages = []
    mock_cursor.fetchone.return_value = ('TestDb',)
    mock_pyodbc_conn.cursor.return_value = mock_cursor
    adapter.connection = mock_pyodbc_conn

    # Test get_intellisense_objects passes limit=0 and maps types correctly
    items = adapter.get_intellisense_objects(database='TestDb', schema='dbo')
    assert len(items) == 6
    type_map = {item['name']: item['type'] for item in items}
    assert type_map['Customer'] == 'table'
    assert type_map['Customer_View'] == 'view'
    assert type_map['usp_GetCustomer'] == 'procedure'
    assert type_map['fn_Calculate'] == 'function'
    assert type_map['trg_Audit'] == 'trigger'
    assert type_map['syn_Item'] == 'synonym'
    assert items[5]['target_object'] == 'OtherDB.dbo.Item'
    print('[PASS] SqlServerAdapter.get_intellisense_objects passes limit=0 and maps all object types')

if __name__ == '__main__':
    test_intellisense_endpoints()
    test_sqlserver_adapter_intellisense()
    print('ALL INTELLISENSE TESTS PASSED!')
