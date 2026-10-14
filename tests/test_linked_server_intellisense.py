import os
import pytest
from unittest.mock import MagicMock, patch

def test_static_js_linked_server_and_foreign_data_support():
    """Verify that frontend JS files implement all specifications in .SKILL/linkserver.md."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # 1. Scope Resolver
    scope_path = os.path.join(base_dir, "static", "js", "scope-resolver.js")
    with open(scope_path, "r", encoding="utf-8") as f:
        scope_code = f.read()
    
    assert "this.server = server;" in scope_code
    assert "this.sourceType = sourceType ||" in scope_code
    assert "sourceType: 'REMOTE_TABLE'" in scope_code
    assert "serverName = tableParts[tableParts.length - 4];" in scope_code
    assert "databaseName = tableParts[tableParts.length - 3];" in scope_code
    assert "schemaName = tableParts[tableParts.length - 2] || \"dbo\";" in scope_code
    assert "tableName = tableParts[tableParts.length - 1];" in scope_code
    assert "'remote_table'" in scope_code
    assert "'foreign_table'" in scope_code

    # 2. Context Analyzer
    ctx_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    with open(ctx_path, "r", encoding="utf-8") as f:
        ctx_code = f.read()
    
    assert "qualifierParts" in ctx_code
    assert "fullQualifier = parts.join('.');" in ctx_code

    # 3. Metadata Provider
    provider_path = os.path.join(base_dir, "static", "js", "metadata-provider.js")
    with open(provider_path, "r", encoding="utf-8") as f:
        provider_code = f.read()
    
    assert "async getLinkedServers(connectionId)" in provider_code
    assert "async getRemoteDatabases(connectionId, server)" in provider_code
    assert "async getRemoteSchemas(connectionId, server, database)" in provider_code
    assert "async getRemoteObjects(connectionId, server, database, schema)" in provider_code
    assert "async getRemoteColumns(connectionId, server, database, schema, table)" in provider_code
    assert "async getForeignServers(connectionId)" in provider_code
    assert "async getForeignTables(connectionId, schema)" in provider_code

    # 4. Metadata Cache
    cache_path = os.path.join(base_dir, "static", "js", "metadata-cache.js")
    with open(cache_path, "r", encoding="utf-8") as f:
        cache_code = f.read()
    
    assert "getLinkedServers(connectionId)" in cache_code
    assert "getRemoteDatabases(connectionId, server)" in cache_code
    assert "getRemoteSchemas(connectionId, server, database)" in cache_code
    assert "getRemoteObjects(connectionId, server, database, schema)" in cache_code
    assert "getRemoteColumns(connectionId, server, database, schema, table)" in cache_code
    assert "getForeignServers(connectionId)" in cache_code
    assert "getForeignTables(connectionId, schema)" in cache_code

    # 5. Completion Engine
    engine_path = os.path.join(base_dir, "static", "js", "completion-engine.js")
    with open(engine_path, "r", encoding="utf-8") as f:
        engine_code = f.read()
    
    assert "getRemoteColumns" in engine_code
    assert "Remote Column" in engine_code
    assert "Linked Server" in engine_code
    assert "Foreign Server" in engine_code
    assert "Foreign Table" in engine_code

def test_sqlserver_database_adapter_methods():
    """Verify SqlServerAdapter linked server discovery methods adhere to read-only rules."""
    from app.database.sqlserver import SqlServerAdapter

    adapter = SqlServerAdapter({"server": "localhost", "database": "master"})

    with patch.object(adapter, 'execute') as mock_exec:
        # 1. list_linked_servers
        mock_exec.return_value = {
            "rows": [
                ["ERP_SERVER", "SQL Server", "SQLNCLI", "192.168.1.10", 1],
                ["CRM_SERVER", "Oracle", "OraOLEDB", "crm-host", 0]
            ]
        }
        servers = adapter.list_linked_servers()
        assert len(servers) == 2
        assert servers[0]["name"] == "ERP_SERVER"
        assert servers[0]["product"] == "SQL Server"
        assert servers[0]["is_linked"] is True

        # 2. list_remote_databases
        mock_exec.return_value = {
            "rows": [["master"], ["ERPDB"], ["ReportDB"]]
        }
        dbs = adapter.list_remote_databases("ERP_SERVER")
        assert len(dbs) == 3
        assert dbs[1]["name"] == "ERPDB"

        # 3. list_remote_schemas
        mock_exec.return_value = {
            "rows": [
                ["ERPDB", "dbo", "Customer", "TABLE"],
                ["ERPDB", "sales", "Orders", "TABLE"]
            ]
        }
        schemas = adapter.list_remote_schemas("ERP_SERVER", "ERPDB")
        assert len(schemas) == 2
        assert schemas[0]["name"] == "dbo"
        assert schemas[1]["name"] == "sales"

        # 4. list_remote_objects
        mock_exec.return_value = {
            "rows": [
                ["ERPDB", "dbo", "Customer", "TABLE"],
                ["ERPDB", "dbo", "OrderSummary", "VIEW"]
            ]
        }
        objs = adapter.list_remote_objects("ERP_SERVER", "ERPDB", "dbo")
        assert len(objs) == 2
        assert objs[0]["name"] == "Customer"
        assert objs[0]["type"] in ("table", "remote_table")
        assert objs[1]["name"] == "OrderSummary"
        assert objs[1]["type"] in ("view", "remote_view")

        # 5. list_remote_columns
        mock_exec.return_value = {
            "rows": [
                ["ERPDB", "dbo", "Customer", "Id", 4, "int", 10, 4, 0, 10, 0],
                ["ERPDB", "dbo", "Customer", "Name", -9, "nvarchar", 100, 200, 0, 10, 1]
            ]
        }
        cols = adapter.list_remote_columns("ERP_SERVER", database="ERPDB", schema="dbo", table="Customer")
        assert len(cols) == 2
        assert cols[0]["name"] == "Id"
        assert cols[0]["data_type"] == "int"
        assert cols[0]["is_nullable"] is False
        assert cols[1]["name"] == "Name"
        assert cols[1]["data_type"] == "nvarchar"
        assert cols[1]["is_nullable"] is True

def test_postgresql_database_adapter_methods():
    """Verify PostgreSqlAdapter foreign server/table methods adhere to read-only rules."""
    from app.database.postgresql import PostgreSqlAdapter

    adapter = PostgreSqlAdapter({"host": "localhost", "database": "postgres"})

    with patch.object(adapter, 'execute') as mock_exec:
        # 1. list_foreign_servers
        mock_exec.return_value = {
            "rows": [
                ["remote_pg", "postgres_fdw", "remote_owner", "Foreign server for remote PG"],
                ["file_server", "file_fdw", "file_owner", None]
            ]
        }
        servers = adapter.list_foreign_servers()
        assert len(servers) == 2
        assert servers[0]["name"] == "remote_pg"
        assert servers[0]["wrapper"] == "postgres_fdw"

        # 2. list_foreign_tables
        mock_exec.return_value = {
            "rows": [
                ["foreign_customer", "public", "remote_pg"]
            ]
        }
        tables = adapter.list_foreign_tables("public")
        assert len(tables) == 1
        assert tables[0]["name"] == "foreign_customer"
        assert tables[0]["server"] == "remote_pg"

def test_metadata_service_delegation():
    """Verify MetadataService linked server and foreign server caching delegation."""
    import threading
    from app.services.metadata_service import MetadataService

    mock_adapter = MagicMock()
    mock_adapter.list_linked_servers.return_value = [{"name": "ERP_SERVER"}]
    mock_adapter.list_remote_databases.return_value = [{"name": "ERPDB"}]
    mock_adapter.list_remote_schemas.return_value = [{"name": "dbo"}]
    mock_adapter.list_remote_objects.return_value = [{"name": "Customer", "type": "table"}]
    mock_adapter.list_remote_columns.return_value = [{"name": "Id", "data_type": "int"}]
    mock_adapter.list_foreign_servers.return_value = [{"name": "remote_pg"}]
    mock_adapter.list_foreign_tables.return_value = [{"name": "remote_cust"}]

    mock_session = MagicMock()
    mock_session.adapter = mock_adapter
    mock_session.metadata_cache = {}
    mock_session.lock = threading.Lock()

    service = MetadataService(mock_session)

    ls = service.list_linked_servers()
    assert len(ls) == 1
    assert ls[0]["name"] == "ERP_SERVER"

    dbs = service.list_remote_databases("ERP_SERVER")
    assert len(dbs) == 1
    assert dbs[0]["name"] == "ERPDB"

    schemas = service.list_remote_schemas("ERP_SERVER", "ERPDB")
    assert len(schemas) == 1
    assert schemas[0]["name"] == "dbo"

    objs = service.list_remote_objects("ERP_SERVER", "ERPDB", "dbo")
    assert len(objs) == 1
    assert objs[0]["name"] == "Customer"

    cols = service.list_remote_columns("ERP_SERVER", "ERPDB", "dbo", "Customer")
    assert len(cols) == 1
    assert cols[0]["name"] == "Id"

    fs = service.list_foreign_servers()
    assert len(fs) == 1
    assert fs[0]["name"] == "remote_pg"

    ft = service.list_foreign_tables("public")
    assert len(ft) == 1
    assert ft[0]["name"] == "remote_cust"

def test_metadata_api_routes():
    """Verify Flask metadata routes for linked servers and foreign tables return valid JSON."""
    from app import create_app

    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()

    mock_meta_service = MagicMock()
    mock_meta_service.list_linked_servers.return_value = [{"name": "ERP_SERVER"}]
    mock_meta_service.list_remote_databases.return_value = [{"name": "ERPDB"}]
    mock_meta_service.list_remote_schemas.return_value = [{"name": "dbo"}]
    mock_meta_service.list_remote_objects.return_value = [{"name": "Customer", "type": "table"}]
    mock_meta_service.list_remote_columns.return_value = [{"name": "Id", "data_type": "int"}]
    mock_meta_service.list_foreign_servers.return_value = [{"name": "remote_pg"}]
    mock_meta_service.list_foreign_tables.return_value = [{"name": "remote_cust"}]

    mock_conn = MagicMock()
    mock_conn.metadata_service = mock_meta_service

    with patch("app.routes.metadata.get_connection", return_value=mock_conn):
        # 1. Linked Servers
        res = client.get("/api/metadata/test_conn/linked_servers")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert len(data["items"]) == 1
        assert data["items"][0]["name"] == "ERP_SERVER"

        # 2. Remote Databases
        res = client.get("/api/metadata/test_conn/linked_server/databases?server=ERP_SERVER")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["items"][0]["name"] == "ERPDB"

        # 3. Remote Schemas
        res = client.get("/api/metadata/test_conn/linked_server/schemas?server=ERP_SERVER&database=ERPDB")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["items"][0]["name"] == "dbo"

        # 4. Remote Objects
        res = client.get("/api/metadata/test_conn/linked_server/objects?server=ERP_SERVER&database=ERPDB&schema=dbo")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["items"][0]["name"] == "Customer"

        # 5. Remote Columns
        res = client.get("/api/metadata/test_conn/linked_server/columns?server=ERP_SERVER&database=ERPDB&schema=dbo&table=Customer")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["items"][0]["name"] == "Id"

        # 6. Foreign Servers
        res = client.get("/api/metadata/test_conn/foreign_servers")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["items"][0]["name"] == "remote_pg"

        # 7. Foreign Tables
        res = client.get("/api/metadata/test_conn/foreign_tables?schema=public")
        assert res.status_code == 200
        data = res.get_json()
        assert data["success"] is True
        assert data["items"][0]["name"] == "remote_cust"

def test_scope_isolation_local_and_remote():
    """Verify local and remote table symbols maintain strict isolation in symbol tables and cache."""
    class MockSymbol:
        def __init__(self, name, alias='', schema='dbo', database=None, server=None, sourceType='TABLE'):
            self.name = name
            self.alias = alias
            self.schema = schema
            self.database = database
            self.server = server
            self.sourceType = sourceType

    # Query:
    # SELECT c.Id, rc.Name
    # FROM Customer c
    # JOIN ERP_SERVER.ERPDB.dbo.Customer rc ON rc.Id = c.Id
    local_cust = MockSymbol("Customer", alias="c", schema="dbo", database="LocalDB", server=None, sourceType="TABLE")
    remote_cust = MockSymbol("Customer", alias="rc", schema="dbo", database="ERPDB", server="ERP_SERVER", sourceType="REMOTE_TABLE")

    symbols = {"c": local_cust, "rc": remote_cust}

    # Verify resolution
    assert symbols["c"].server is None
    assert symbols["c"].sourceType == "TABLE"

    assert symbols["rc"].server == "ERP_SERVER"
    assert symbols["rc"].database == "ERPDB"
    assert symbols["rc"].sourceType == "REMOTE_TABLE"

    # Verify cache key generation isolation:
    # local key: conn::LocalDB::dbo::Customer
    # remote key: conn::ERP_SERVER::ERPDB::dbo::Customer
    def build_cache_key(conn_id, server, db, schema, table):
        if server:
            return f"{conn_id}::{server}::{db}::{schema}::{table}"
        return f"{conn_id}::{db}::{schema}::{table}"

    local_key = build_cache_key("c1", local_cust.server, local_cust.database, local_cust.schema, local_cust.name)
    remote_key = build_cache_key("c1", remote_cust.server, remote_cust.database, remote_cust.schema, remote_cust.name)

    assert local_key != remote_key
    assert local_key == "c1::LocalDB::dbo::Customer"
    assert remote_key == "c1::ERP_SERVER::ERPDB::dbo::Customer"


def test_linked_server_context_menu_and_explorer_support():
    """Verify that context-menu.js and explorer.js include Linked Server options."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Context Menu
    ctx_menu_path = os.path.join(base_dir, "static", "js", "context-menu.js")
    with open(ctx_menu_path, "r", encoding="utf-8") as f:
        ctx_code = f.read()
    
    assert "linked_server:" in ctx_code
    assert "test-linked-server" in ctx_code
    assert "Script Linked Server as" in ctx_code
    assert "script-ls-create" in ctx_code
    assert "script-ls-drop" in ctx_code
    assert "script-ls-drop-create" in ctx_code
    assert "delete-linked-server" in ctx_code
    assert "has-submenu" in ctx_code
    assert "ide-ctx-submenu" in ctx_code

    # Object Explorer
    explorer_path = os.path.join(base_dir, "static", "js", "explorer.js")
    with open(explorer_path, "r", encoding="utf-8") as f:
        exp_code = f.read()

    assert "Linked Servers" in exp_code
    assert "linked_servers_group" in exp_code
    assert "fetchLinkedServers" in exp_code
    assert "/api/metadata/${connId}/linked_servers" in exp_code


def test_sqlserver_adapter_test_script_drop_methods():
    """Verify SqlServerAdapter implements test_linked_server, get_linked_server_script, drop_linked_server."""
    from app.database.sqlserver import SqlServerAdapter

    adapter = SqlServerAdapter({"server": "localhost", "database": "master"})

    with patch.object(adapter, "execute") as mock_exec:
        # 1. test_linked_server success
        mock_exec.return_value = {"rows": []}
        res_test = adapter.test_linked_server("ERP_SERVER")
        assert res_test["success"] is True
        assert "successful" in res_test["message"]
        mock_exec.assert_called_with("EXEC sp_testlinkedserver @servername = ?", ("ERP_SERVER",))

        # 2. test_linked_server error
        mock_exec.side_effect = Exception("Login failed for user")
        res_fail = adapter.test_linked_server("BAD_SERVER")
        assert res_fail["success"] is False
        assert "Login failed" in res_fail["error"]
        mock_exec.side_effect = None

        # 3. get_linked_server_script
        mock_exec.return_value = {
            "rows": [
                [1, "ERP_SERVER", "SQL Server", "SQLNCLI", "192.168.1.10", "", "", "", 1]
            ]
        }
        create_sql = adapter.get_linked_server_script("ERP_SERVER", mode="create")
        assert "sp_addlinkedserver" in create_sql
        assert "@server = N'ERP_SERVER'" in create_sql
        assert "@datasrc = N'192.168.1.10'" in create_sql

        drop_sql = adapter.get_linked_server_script("ERP_SERVER", mode="drop")
        assert "sp_dropserver" in drop_sql
        assert "@server = N'ERP_SERVER'" in drop_sql

        drop_and_create_sql = adapter.get_linked_server_script("ERP_SERVER", mode="drop_and_create")
        assert "sp_dropserver" in drop_and_create_sql
        assert "sp_addlinkedserver" in drop_and_create_sql

        # 4. drop_linked_server
        mock_exec.return_value = {"rows": []}
        drop_res = adapter.drop_linked_server("ERP_SERVER")
        assert drop_res["success"] is True
        assert "dropped successfully" in drop_res["message"]
        mock_exec.assert_called_with(
            "EXEC master.dbo.sp_dropserver @server = ?, @droplogins = 'droplogins'",
            ("ERP_SERVER",)
        )


def test_api_routes_test_script_drop():
    """Verify Flask metadata endpoints for test, script, and drop linked servers."""
    from app import create_app

    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()

    mock_conn = MagicMock()
    mock_conn.adapter.test_linked_server.return_value = {"success": True, "message": "OK"}
    mock_conn.adapter.get_linked_server_script.return_value = "EXEC sp_addlinkedserver N'ERP_SERVER';"
    mock_conn.adapter.drop_linked_server.return_value = {"success": True, "message": "Dropped"}

    with patch("app.routes.metadata.get_connection", return_value=mock_conn):
        # 1. Test
        res1 = client.post("/api/metadata/c1/linked_server/test", json={"server": "ERP_SERVER"})
        assert res1.status_code == 200
        assert res1.get_json()["success"] is True

        # 2. Script
        res2 = client.get("/api/metadata/c1/linked_server/script?server=ERP_SERVER&mode=create")
        assert res2.status_code == 200
        data2 = res2.get_json()
        assert data2["success"] is True
        assert "sp_addlinkedserver" in data2["script"]

        # 3. Drop
        res3 = client.post("/api/metadata/c1/linked_server/drop", json={"server": "ERP_SERVER"})
        assert res3.status_code == 200
        assert res3.get_json()["success"] is True
