import sys
from unittest.mock import MagicMock
if 'webview' not in sys.modules:
    sys.modules['webview'] = MagicMock()

import pytest
from main import MainApi

def test_main_api_linked_servers():
    mock_cm = MagicMock()
    mock_conn = MagicMock()
    mock_cm.get.return_value = mock_conn
    mock_cm._connections = {}
    
    # Mock metadata_service
    mock_conn.metadata_service.list_linked_servers.return_value = [
        {
            "server_id": 1,
            "name": "REMOTE_SRV",
            "LinkedServerName": "REMOTE_SRV",
            "product": "SQL Server",
            "provider": "SQLNCLI",
            "data_source": "192.168.1.100",
            "is_linked": True
        }
    ]
    mock_conn.metadata_service.list_remote_databases.return_value = [{"name": "RemoteDB"}]
    mock_conn.adapter.test_linked_server.return_value = {"success": True, "message": "Connection successful"}
    mock_conn.adapter.get_linked_server_script.return_value = "EXEC sp_addlinkedserver ..."
    mock_conn.adapter.drop_linked_server.return_value = {"success": True}

    api = MainApi(mock_cm)

    # 1. get_linked_servers
    res = api.get_linked_servers("conn1")
    assert res["success"] is True
    assert len(res["items"]) == 1
    assert res["items"][0]["name"] == "REMOTE_SRV"

    # 2. get_remote_databases
    res_db = api.get_remote_databases("conn1", "REMOTE_SRV")
    assert res_db["success"] is True
    assert res_db["items"][0]["name"] == "RemoteDB"

    # 3. test_linked_server
    res_test = api.test_linked_server("conn1", "REMOTE_SRV")
    assert res_test["success"] is True

    # 4. get_linked_server_script
    res_script = api.get_linked_server_script("conn1", "REMOTE_SRV", "create")
    assert res_script["success"] is True
    assert "sp_addlinkedserver" in res_script["script"]

    # 5. drop_linked_server
    res_drop = api.drop_linked_server("conn1", "REMOTE_SRV")
    assert res_drop["success"] is True


def test_api_js_has_linked_server_routes():
    import os
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    api_js_path = os.path.join(base_dir, "static", "js", "api.js")
    with open(api_js_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "action === 'linked_servers'" in content
    assert "api.get_linked_servers(connId)" in content
    assert "action === 'linked_server'" in content
    assert "subAction === 'databases'" in content
    assert "subAction === 'test'" in content
    assert "subAction === 'script'" in content
    assert "subAction === 'drop'" in content

