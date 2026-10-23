"""
test_cross_database_intellisense.py - Unit and Static Verification Tests
for Cross-Database IntelliSense on SQL Server.
"""

import os
import threading
import pytest
from unittest.mock import MagicMock, patch


def test_sqlserver_adapter_list_databases_metadata():
    """Verify SqlServerAdapter.list_databases includes is_system, has_access and accessible_only flag."""
    from app.database.sqlserver import SqlServerAdapter

    adapter = SqlServerAdapter({"server": "localhost", "database": "master"})

    with patch.object(adapter, 'execute') as mock_exec:
        # Mock sys.databases query result: name, state_desc, is_system, has_access
        mock_exec.return_value = {
            "rows": [
                ["AppDB", "ONLINE", 0, 1],
                ["SalesDB", "ONLINE", 0, 1],
                ["RestrictedDB", "ONLINE", 0, 0],
                ["master", "ONLINE", 1, 1],
                ["model", "ONLINE", 1, 1],
                ["msdb", "ONLINE", 1, 1],
                ["tempdb", "ONLINE", 1, 1]
            ]
        }
        
        # Test accessible_only=False (default for Cross-Database IntelliSense)
        all_dbs = adapter.list_databases(accessible_only=False)
        assert len(all_dbs) == 7
        assert all_dbs[0]["name"] == "AppDB"
        assert all_dbs[0]["is_system"] is False
        assert all_dbs[0]["has_access"] is True
        assert all_dbs[2]["name"] == "RestrictedDB"
        assert all_dbs[2]["has_access"] is False
        assert all_dbs[3]["name"] == "master"
        assert all_dbs[3]["is_system"] is True

        # Test accessible_only=True
        acc_dbs = adapter.list_databases(accessible_only=True)
        assert len(acc_dbs) == 6
        assert not any(d["name"] == "RestrictedDB" for d in acc_dbs)

        # Verify SQL query generated
        call_sql = mock_exec.call_args[0][0]
        assert "HAS_DBACCESS" in call_sql or "sys.databases" in call_sql
        assert "name NOT IN" not in call_sql  # master, model, msdb, tempdb must not be excluded


def test_metadata_service_cache_and_accessible_flag():
    """Verify MetadataService caches accessible and all databases under distinct keys."""
    from app.services.metadata_service import MetadataService

    mock_session = MagicMock()
    mock_session.metadata_cache = {}
    mock_session.lock = threading.Lock()
    mock_adapter = MagicMock()
    mock_adapter.list_databases.side_effect = lambda accessible_only=False: [
        {"name": "DB1", "is_system": False, "has_access": True},
        {"name": "master", "is_system": True, "has_access": True}
    ] if not accessible_only else [
        {"name": "DB1", "is_system": False, "has_access": True}
    ]
    mock_session.adapter = mock_adapter

    service = MetadataService(mock_session)

    # 1. Fetch all databases
    dbs_all = service.list_databases(accessible_only=False)
    assert len(dbs_all) == 2
    mock_adapter.list_databases.assert_called_with(accessible_only=False)

    # 2. Fetch accessible databases
    dbs_acc = service.list_databases(accessible_only=True)
    assert len(dbs_acc) == 1
    mock_adapter.list_databases.assert_called_with(accessible_only=True)

    # 3. Check cache separation: calling again should hit cache
    mock_adapter.list_databases.reset_mock()
    cached_all = service.list_databases(accessible_only=False)
    assert len(cached_all) == 2
    cached_acc = service.list_databases(accessible_only=True)
    assert len(cached_acc) == 1
    assert mock_adapter.list_databases.call_count == 0


def test_metadata_routes_and_api():
    """Verify metadata Flask routes and API layer pass accessible_only parameter."""
    import inspect
    from app.api.metadata_api import MetadataApiMixin
    from app.routes.metadata import databases

    # Inspect MetadataApiMixin.get_databases parameter signature
    sig = inspect.signature(MetadataApiMixin.get_databases)
    assert "accessible_only" in sig.parameters

    # Inspect route source to ensure accessible_only query parameter is read
    route_src = inspect.getsource(databases)
    assert "accessible_only" in route_src


def test_static_js_cross_database_frontend_files():
    """Verify all cross-database features are implemented across frontend JS files."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 1. metadata-provider.js
    mp_path = os.path.join(base_dir, "static", "js", "metadata-provider.js")
    with open(mp_path, "r", encoding="utf-8") as f:
        mp_code = f.read()
    assert "data.items" in mp_code, "metadata-provider.js must read data.items for G6 contract"

    # 2. intellisense.js
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")
    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()
    assert "database: 'fa-database text-primary'" in is_code
    assert "schema: 'fa-layer-group text-secondary'" in is_code
    assert "cand.type === 'database' && cand.isSystemDb" in is_code
    assert "item.type === 'database'" in is_code
    assert "item.database || tabCtx.database" in is_code
    assert "getDatabases" in is_code
    assert "fetchDatabases" in is_code
    assert "getSchemas" in is_code
    assert "fetchSchemas" in is_code

    # 3. candidate-generator.js
    cg_path = os.path.join(base_dir, "static", "js", "candidate-generator.js")
    with open(cg_path, "r", encoding="utf-8") as f:
        cg_code = f.read()
    assert "_getServerDatabases" in cg_code
    assert "_getDatabaseSchemas" in cg_code
    assert "allCandidates.push({" in cg_code
    assert "type: 'database'" in cg_code
    assert "tbl.database || tabCtx.database" in cg_code
    assert "effectiveDb = targetDatabase || tabCtx.database" in cg_code
    assert "rightTable.database || tabCtx.database" in cg_code
    assert "pt.database || tabCtx.database" in cg_code
    assert "lt.database || tabCtx.database" in cg_code
    assert "isSystemDb: isSystem" in cg_code

    # 4. context-analyzer.js
    ca_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    with open(ca_path, "r", encoding="utf-8") as f:
        ca_code = f.read()
    assert "databaseName = tableParts[0];" in ca_code
    assert "serverName = tableParts[tableParts.length - 4];" in ca_code
    assert "database: databaseName" in ca_code
    assert "database: info.database || ''" in ca_code

    # 5. completion-ranker.js
    cr_path = os.path.join(base_dir, "static", "js", "completion-ranker.js")
    with open(cr_path, "r", encoding="utf-8") as f:
        cr_code = f.read()
    assert "const isUseClause = (context.clause === 'USE');" in cr_code
    assert "type === 'database'" in cr_code
    assert "contextScore += item.isSystemDb ? 35 : 65;" in cr_code
    assert "contextScore += item.isSystemDb ? 85 : 120;" in cr_code
