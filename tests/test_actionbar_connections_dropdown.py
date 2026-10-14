"""
Tests for Action Bar Connection Dropdown to ensure saved connections are retrieved and displayed properly.
"""
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app import create_app

def test_api_connections_returns_saved_connections():
    app = create_app()
    client = app.test_client()
    res = client.get('/api/connections')
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert "saved_connections" in data
    assert isinstance(data["saved_connections"], list)
    assert len(data["saved_connections"]) > 0
    # Group markers should not be in saved_connections
    for c in data["saved_connections"]:
        assert c.get("type") != "group_marker"
        assert not str(c.get("name", "")).startswith("__group__")

def test_query_js_logic_for_saved_connections():
    query_js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "query.js"
    content = query_js_path.read_text(encoding="utf-8")
    
    # Verify prioritization of data.saved_connections
    assert "if (data && Array.isArray(data.saved_connections) && data.saved_connections.length > 0)" in content
    assert "savedList = data.saved_connections;" in content
    # Verify fallback to AppExplorer, AppStorage, and localStorage
    assert "window.AppExplorer.getSavedConnections()" in content
    assert "window.AppStorage.getSavedConnections()" in content
    assert "localStorage.getItem('ide_saved_connections')" in content
    # Verify caching to localStorage
    assert "localStorage.setItem('ide_saved_connections', JSON.stringify(savedList))" in content

def test_explorer_js_get_saved_connections_cache_fallback():
    explorer_js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "explorer.js"
    content = explorer_js_path.read_text(encoding="utf-8")
    assert "function getSavedConnections()" in content
    assert "localStorage.getItem('ide_saved_connections')" in content

if __name__ == "__main__":
    test_api_connections_returns_saved_connections()
    test_query_js_logic_for_saved_connections()
    test_explorer_js_get_saved_connections_cache_fallback()
    print("ALL TESTS PASSED SUCCESSFULLY!")
