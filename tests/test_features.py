from app import create_app
from unittest.mock import MagicMock, patch, call
from app.database.sqlserver import SqlServerAdapter

def test_features():
    app = create_app()
    app.config.update(TESTING=True)

    with app.test_client() as client:
        # 1. Test index contains the new database filter button
        res = client.get('/')
        assert b'id="ide-btn-filter-db"' in res.data, 'Missing filter button in sidebar'
        print('[PASS] Sidebar filter button present')

        # 2. Test metadata search filtering logic
        with patch('app.routes.metadata.get_connection') as mock_get_conn:
            mock_conn = MagicMock()
            mock_conn.metadata_service.list_databases.return_value = ['AdventureWorks', 'master', 'tempdb']
            mock_conn.metadata_service.list_schemas.return_value = ['dbo', 'sales', 'guest']
            mock_get_conn.return_value = mock_conn

            # Test search databases
            res = client.get('/api/metadata/test-conn/databases?search=master')
            assert res.status_code == 200
            assert res.json['items'] == ['master'], f'Unexpected databases: {res.json}'
            print('[PASS] Database search endpoint works')

            # Test search schemas
            res = client.get('/api/metadata/test-conn/schemas?database=AdventureWorks&search=sal')
            assert res.status_code == 200
            assert res.json['items'] == ['sales'], f'Unexpected schemas: {res.json}'
            print('[PASS] Schema search endpoint works')

        # 3. Test query limit 0 passing and database context passing
        with patch('app.routes.query.get_connection_manager') as mock_cm, \
             patch('app.routes.query.get_owner_session_id') as mock_sid:
            mock_sid.return_value = 'test_owner'
            mock_mgr = MagicMock()
            mock_conn = MagicMock()
            mock_conn.query_service.execute.return_value = {'success': True, 'results': [], 'current_database': 'TestDb'}
            mock_mgr.get.return_value = mock_conn
            mock_cm.return_value = mock_mgr

            res = client.post('/api/query/execute', json={
                'connection_id': 'c1',
                'sql': 'CREATE OR ALTER PROCEDURE dbo.usp_test AS BEGIN SELECT 1 END',
                'limit': 0,
                'database': 'TestDb'
            })
            assert res.status_code == 200
            mock_conn.query_service.execute.assert_called_with(
                'CREATE OR ALTER PROCEDURE dbo.usp_test AS BEGIN SELECT 1 END',
                limit=0,
                database='TestDb',
                schema=None
            )
            print('[PASS] Limit 0 and database passed to execute without prepending USE')

        # 4. Test SQLServerAdapter execution batch separation and USE statement handling
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        mock_pyodbc_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.description = None
        mock_cursor.rowcount = -1
        mock_cursor.messages = []
        mock_cursor.nextset.return_value = False
        mock_cursor.fetchone.return_value = ('TestDb',)
        mock_pyodbc_conn.cursor.return_value = mock_cursor
        adapter.connection = mock_pyodbc_conn

        ddl_sql = "CREATE OR ALTER PROCEDURE dbo.usp_test AS BEGIN SELECT 1 END"
        res = adapter.execute(ddl_sql, database='TestDb')
        assert res['success'] is True
        assert res['current_database'] == 'TestDb'

        # Check call sequence: USE [TestDb] was executed first in its own statement,
        # then the DDL batch was executed as the first statement in its query batch!
        calls = [c[0][0] for c in mock_cursor.execute.call_args_list]
        assert calls[0] == 'USE [TestDb]', f"Expected USE [TestDb], got {calls[0]}"
        assert calls[1] == ddl_sql, f"Expected DDL as first statement, got {calls[1]}"
        print('[PASS] SQLServerAdapter executed USE [TestDb] as separate statement, DDL was first statement in batch')

        # 5. Test SQL with embedded USE without GO is separated properly
        mock_cursor.reset_mock()
        mock_cursor.nextset.return_value = False
        mock_cursor.description = None
        mock_cursor.rowcount = -1
        mock_cursor.fetchone.return_value = ('MyDb',)
        embedded_sql = "USE [MyDb];\nCREATE PROCEDURE dbo.proc1 AS BEGIN SELECT 1 END"
        res = adapter.execute(embedded_sql)
        calls2 = [c[0][0] for c in mock_cursor.execute.call_args_list]
        assert calls2[0] == 'USE [MyDb];', f"Expected USE batch, got {calls2[0]}"
        assert calls2[1] == 'CREATE PROCEDURE dbo.proc1 AS BEGIN SELECT 1 END', f"Expected CREATE batch, got {calls2[1]}"
        print('[PASS] Embedded USE without GO successfully split into two batches')

        # 6. Test connection modal contains SSL and Trust Certificate options
        res = client.get('/')
        assert b'id="connEncrypt"' in res.data, 'Missing SSL/Encrypt checkbox in connection modal'
        assert b'id="connTrustCert"' in res.data, 'Missing Trust Certificate checkbox in connection modal'
        assert b'id="connSqlServerOptionsGroup"' in res.data, 'Missing SQL Server options group in connection modal'
        print('[PASS] Connection modal has SSL and Trust Certificate options')

        # 7. Test interactive context selectors on Action Bar
        assert b'id="ide-ctx-connection"' in res.data, 'Missing ide-ctx-connection button'
        assert b'id="ide-ctx-conn-label"' in res.data, 'Missing ide-ctx-conn-label'
        assert b'id="ide-ctx-conn-menu"' in res.data, 'Missing ide-ctx-conn-menu'
        assert b'id="ide-ctx-database"' in res.data, 'Missing ide-ctx-database button'
        assert b'id="ide-ctx-db-label"' in res.data, 'Missing ide-ctx-db-label'
        assert b'id="ide-ctx-db-search"' in res.data, 'Missing ide-ctx-db-search input'
        assert b'id="ide-ctx-db-menu"' in res.data, 'Missing ide-ctx-db-menu'
        assert b'id="ide-ctx-schema"' in res.data, 'Missing ide-ctx-schema button'
        assert b'id="ide-ctx-schema-label"' in res.data, 'Missing ide-ctx-schema-label'
        assert b'id="ide-ctx-schema-menu"' in res.data, 'Missing ide-ctx-schema-menu'
        print('[PASS] Action bar context selectors and dropdown menus are present')

if __name__ == '__main__':
    test_features()


