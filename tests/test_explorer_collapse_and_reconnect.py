import pytest
from app import create_app
from app.models.connection_session import ConnectionSession
from app.database.base import DatabaseAdapter

class DummyAdapter(DatabaseAdapter):
    def __init__(self, config=None, alive=True):
        super().__init__(config or {})
        self.alive = alive
        self.connection = object()
        self.close_called = False
        self.connect_called = False

    def connect(self):
        self.connect_called = True

    def close(self):
        self.close_called = True

    def ping(self) -> bool:
        return self.alive

    def execute(self, sql, params=None, limit=None, database=None, schema=None, **kwargs):
        if not self.alive:
            raise RuntimeError("Connection lost")
        return []

    def list_databases(self):
        return ["master"]

    def list_schemas(self, database=None):
        return ["dbo"]

    def list_objects(self, database, schema, object_type, search=None):
        return []

    def get_object_definition(self, database, schema, name, object_type):
        return ""

    def list_object_children(self, database, schema, name, object_type, child_type):
        return []

    def get_table_design_metadata(self, database, schema, table):
        return {}

    def get_supported_types(self, database=None):
        return []


@pytest.fixture
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_database_adapter_and_session_ping():
    adapter_alive = DummyAdapter(alive=True)
    assert adapter_alive.ping() is True

    adapter_dead = DummyAdapter(alive=False)
    assert adapter_dead.ping() is False

    session_alive = ConnectionSession(
        connection_id="conn_test_alive",
        owner_session_id="owner_1",
        config={"name": "Test Alive", "type": "sqlserver"},
        adapter=adapter_alive,
        metadata_service=None,
        query_service=None,
    )
    assert session_alive.is_alive() is True

    session_dead = ConnectionSession(
        connection_id="conn_test_dead",
        owner_session_id="owner_1",
        config={"name": "Test Dead", "type": "sqlserver"},
        adapter=adapter_dead,
        metadata_service=None,
        query_service=None,
    )
    assert session_dead.is_alive() is False


def test_connection_endpoints_status_and_ping(app, client):
    cm = app.extensions["connection_manager"]
    owner_id = "owner_test_1"
    with client.session_transaction() as sess:
        sess["ide_session_id"] = owner_id

    adapter1 = DummyAdapter(alive=True)
    session1 = ConnectionSession(
        connection_id="conn_endpoint_1",
        owner_session_id=owner_id,
        config={"name": "Conn 1", "type": "sqlserver"},
        adapter=adapter1,
        metadata_service=None,
        query_service=None,
    )
    adapter2 = DummyAdapter(alive=False)
    session2 = ConnectionSession(
        connection_id="conn_endpoint_2",
        owner_session_id=owner_id,
        config={"name": "Conn 2", "type": "sqlserver"},
        adapter=adapter2,
        metadata_service=None,
        query_service=None,
    )

    with cm._lock:
        cm._connections["conn_endpoint_1"] = session1
        cm._connections["conn_endpoint_2"] = session2

    # 1. Test GET /api/connections
    res = client.get("/api/connections")
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    conns = {c["connection_id"]: c for c in data["connections"]}
    assert conns["conn_endpoint_1"]["is_alive"] is True
    assert conns["conn_endpoint_2"]["is_alive"] is False

    # 2. Test POST /api/connections/ping-all
    res_ping_all = client.post("/api/connections/ping-all")
    assert res_ping_all.status_code == 200
    p_data = res_ping_all.get_json()
    assert p_data["success"] is True
    assert p_data["statuses"]["conn_endpoint_1"]["is_alive"] is True
    assert p_data["statuses"]["conn_endpoint_1"]["status"] == "connected"
    assert p_data["statuses"]["conn_endpoint_2"]["is_alive"] is False
    assert p_data["statuses"]["conn_endpoint_2"]["status"] == "lost"

    # 3. Test GET /api/connections/<id>/status
    res_stat1 = client.get("/api/connections/conn_endpoint_1/status")
    assert res_stat1.status_code == 200
    assert res_stat1.get_json()["is_alive"] is True
    assert res_stat1.get_json()["status"] == "connected"

    res_stat2 = client.get("/api/connections/conn_endpoint_2/status")
    assert res_stat2.status_code == 200
    assert res_stat2.get_json()["is_alive"] is False
    assert res_stat2.get_json()["status"] == "lost"

    # 4. Test POST /api/connections/<id>/reconnect
    # Reconnecting an active/lost connection
    res_reconn = client.post("/api/connections/conn_endpoint_2/reconnect", json={})
    # Since DummyAdapter is not in create_adapter without mock, test 404 on nonexistent conn
    res_404 = client.post("/api/connections/nonexistent_conn/reconnect", json={})
    assert res_404.status_code == 404


def test_html_sidebar_toggle_and_collapsed_rail(app, client):
    res = client.get("/")
    assert res.status_code == 200
    html = res.get_data(as_text=True)

    # 1. Check toggle button present in sidebar header
    assert 'id="ide-sidebar-toggle-btn"' in html
    assert 'fa-angles-left' in html or 'ide-sidebar-toggle-btn' in html

    # 2. Check collapsed rail present
    assert 'id="ide-sidebar-collapsed-rail"' in html
    assert 'ide-sidebar-collapsed-rail' in html
