import os
import pytest
from unittest.mock import MagicMock
from threading import Lock
from flask import Flask

from app.services.metadata_service import MetadataService
from app.routes.metadata import metadata_bp


class DummyAdapter:
    def __init__(self):
        self.call_count = 0

    def list_objects(self, database, schema, object_type, search=None, limit=0):
        self.call_count += 1
        return [
            {"name": f"table_{self.call_count}", "type": "table", "schema": schema or "dbo"}
        ]


class DummySession:
    def __init__(self):
        self.metadata_cache = {}
        self.lock = Lock()
        self.adapter = DummyAdapter()
        self.config = {"type": "sqlserver"}


def test_metadata_service_refresh_and_granular_invalidation():
    session = DummySession()
    service = MetadataService(session)

    # First call: adapter invoked
    items1 = service.list_objects("master", "dbo", "tables", refresh=False)
    assert len(items1) == 1
    assert items1[0]["name"] == "table_1"
    assert session.adapter.call_count == 1

    # Second call without refresh: returned from cache, adapter NOT invoked
    items2 = service.list_objects("master", "dbo", "tables", refresh=False)
    assert items2[0]["name"] == "table_1"
    assert session.adapter.call_count == 1

    # Third call with refresh=True: cache evicted, adapter invoked
    items3 = service.list_objects("master", "dbo", "tables", refresh=True)
    assert items3[0]["name"] == "table_2"
    assert session.adapter.call_count == 2

    # Add items under another database and category to verify granular invalidation
    service.list_objects("testdb", "sales", "views", refresh=False)
    assert len(session.metadata_cache) >= 2

    # Invalidate specifically database "master"
    service.invalidate(database="master")
    # Verify "testdb" cache key is still intact and "master" is removed
    testdb_keys = [k for k in session.metadata_cache.keys() if "testdb" in str(k)]
    assert len(testdb_keys) == 1
    master_keys = [k for k in session.metadata_cache.keys() if "master" in str(k)]
    assert len(master_keys) == 0

    # Invalidate everything
    service.invalidate()
    assert len(session.metadata_cache) == 0


def test_metadata_routes_refresh_and_objects():
    app = Flask(__name__)
    app.register_blueprint(metadata_bp, url_prefix="/api/metadata")
    app.config["TESTING"] = True

    dummy_conn = MagicMock()
    session = DummySession()
    service = MetadataService(session)
    dummy_conn.metadata_service = service

    with app.test_client() as client:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.routes.metadata.get_connection", lambda conn_id: dummy_conn)

            # 1. GET /api/metadata/<conn_id>/objects
            res = client.get("/api/metadata/conn-123/objects?database=mydb&schema=dbo&type=tables")
            assert res.status_code == 200
            data = res.get_json()
            assert data["success"] is True
            assert len(data["items"]) == 1
            assert data["items"][0]["name"] == "table_1"
            assert session.adapter.call_count == 1

            # Second call without refresh: adapter call_count stays 1
            res = client.get("/api/metadata/conn-123/objects?database=mydb&schema=dbo&type=tables")
            assert res.status_code == 200
            assert session.adapter.call_count == 1

            # 2. GET with refresh=true
            res = client.get("/api/metadata/conn-123/objects?database=mydb&schema=dbo&type=tables&refresh=true")
            assert res.status_code == 200
            data = res.get_json()
            assert data["items"][0]["name"] == "table_2"
            assert session.adapter.call_count == 2

            # 3. POST /api/metadata/<conn_id>/refresh
            res = client.post(
                "/api/metadata/conn-123/refresh",
                json={"database": "mydb", "schema": "dbo", "type": "tables"}
            )
            assert res.status_code == 200
            data = res.get_json()
            assert data["success"] is True
            assert "invalidated" in data["message"].lower()

            # Next GET without refresh should fetch newly because cache was invalidated
            res = client.get("/api/metadata/conn-123/objects?database=mydb&schema=dbo&type=tables")
            assert res.status_code == 200
            assert session.adapter.call_count == 3


def test_explorer_and_editor_frontend_integration():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 1. templates/index.html checks
    with open(os.path.join(repo_root, "templates", "index.html"), "r", encoding="utf-8") as f:
        html = f.read()

    assert 'id="ide-explorer-search-input"' in html
    assert 'id="ide-explorer-search-clear"' in html
    assert 'id="ide-menu-refresh-objects-intellisense"' in html
    assert 'Refresh Objects &amp; IntelliSense' in html or 'Refresh Objects & IntelliSense' in html

    # 2. static/css/explorer.css checks
    with open(os.path.join(repo_root, "static", "css", "explorer.css"), "r", encoding="utf-8") as f:
        css = f.read()

    assert ".ide-sidebar-search" in css
    assert ".ide-search-box" in css
    assert ".ide-search-input" in css
    assert ".ide-search-clear-btn" in css
    assert ".tree-node-filtered-out" in css
    assert ".tree-search-highlight" in css

    # 3. static/js/explorer.js checks
    with open(os.path.join(repo_root, "static", "js", "explorer.js"), "r", encoding="utf-8") as f:
        explorer_js = f.read()

    assert "applyTreeFilter" in explorer_js
    assert "filterTree: applyTreeFilter" in explorer_js
    assert "clearCategoryCache" in explorer_js
    assert "refreshNode" in explorer_js
    assert "ide-explorer-search-input" in explorer_js
    assert "ide-explorer-search-clear" in explorer_js

    # 4. static/js/context-menu.js checks
    with open(os.path.join(repo_root, "static", "js", "context-menu.js"), "r", encoding="utf-8") as f:
        cm_js = f.read()

    assert "case 'refresh':" in cm_js
    assert "window.AppExplorer.refreshNode" in cm_js

    # 5. static/js/editor.js checks
    with open(os.path.join(repo_root, "static", "js", "editor.js"), "r", encoding="utf-8") as f:
        editor_js = f.read()

    assert "sql-refresh-objects-intellisense" in editor_js
    assert "refreshActiveConnectionObjectsAndIntelliSense" in editor_js
    assert "ide-menu-refresh-objects-intellisense" in editor_js

    # 6. static/js/intellisense.js checks
    with open(os.path.join(repo_root, "static", "js", "intellisense.js"), "r", encoding="utf-8") as f:
        is_js = f.read()

    assert "invalidateConnection" in is_js
