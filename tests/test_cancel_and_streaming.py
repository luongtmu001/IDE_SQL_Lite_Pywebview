from unittest.mock import MagicMock, patch
from app import create_app
from app.database.sqlserver import SqlServerAdapter
from app.services.query_service import QueryService

def test_query_cancel_endpoint():
    app = create_app()
    app.config.update(TESTING=True)

    with app.test_client() as client:
        with patch('app.routes.query.get_connection_manager') as mock_cm, \
             patch('app.routes.query.get_owner_session_id') as mock_sid:
            mock_sid.return_value = 'test_owner'
            mock_mgr = MagicMock()
            mock_conn = MagicMock()
            mock_conn.query_service.cancel.return_value = True
            mock_mgr.get.return_value = mock_conn
            mock_cm.return_value = mock_mgr

            res = client.post('/api/query/cancel', json={'connection_id': 'conn1'})
            assert res.status_code == 200
            assert res.json['success'] is True
            mock_conn.query_service.cancel.assert_called_once()

def test_query_service_cancel():
    mock_session = MagicMock()
    mock_adapter = MagicMock()
    mock_adapter.cancel.return_value = True
    mock_session.adapter = mock_adapter

    qs = QueryService(mock_session)
    res = qs.cancel()
    assert res is True
    mock_adapter.cancel.assert_called_once()

def test_sqlserver_cancel_invokes_cursor_cancel():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    mock_cursor = MagicMock()
    adapter._active_cursor = mock_cursor

    res = adapter.cancel()
    assert res is True
    assert adapter._is_cancelled is True
    mock_cursor.cancel.assert_called_once()

def test_sqlserver_execute_streaming_progress_callback():
    adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
    adapter.connection = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.nextset.return_value = False
    adapter.connection.cursor.return_value = mock_cursor
    mock_cursor.description = [('id',), ('name',)]

    # Mock fetchmany returning 2 rows then None
    mock_cursor.fetchmany.side_effect = [
        [(1, 'Alice'), (2, 'Bob')],
        []
    ]

    events = []
    def callback(evt):
        events.append(evt)

    result = adapter.execute("SELECT id, name FROM users", progress_callback=callback)

    assert len(events) == 2
    assert events[0]['type'] == 'columns'
    assert events[0]['columns'] == ['id', 'name']
    assert events[1]['type'] == 'chunk'
    assert len(events[1]['rows']) == 2
    assert result['results'][0]['row_count'] == 2

def test_find_replace_dialog_removed_from_template():
    app = create_app()
    app.config.update(TESTING=True)

    with app.test_client() as client:
        res = client.get('/')
        assert res.status_code == 200
        # Custom find-replace dialog should no longer exist in HTML
        assert b'id="ide-find-replace-dialog"' not in res.data
