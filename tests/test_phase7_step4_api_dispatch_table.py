"""
Phase 7 Step 4 Test:
Verify that static/js/api.js implements a declarative ROUTE_DISPATCH_TABLE with
explicit target method verification and descriptive 501 error reporting for missing native methods.
"""
import re
from pathlib import Path
import pytest

WORKSPACE_DIR = Path(__file__).resolve().parent.parent
API_JS_PATH = WORKSPACE_DIR / "static" / "js" / "api.js"
DIST_API_JS_PATH = WORKSPACE_DIR / "dist" / "LLTool" / "_internal" / "static" / "js" / "api.js"


def test_api_js_declares_dispatch_table():
    """Verify that ROUTE_DISPATCH_TABLE is defined and exported in static/js/api.js."""
    assert API_JS_PATH.exists(), f"api.js missing at {API_JS_PATH}"
    content = API_JS_PATH.read_text(encoding="utf-8")

    assert "ROUTE_DISPATCH_TABLE" in content, "api.js must define ROUTE_DISPATCH_TABLE"
    assert "global.ROUTE_DISPATCH_TABLE" in content or "window.ROUTE_DISPATCH_TABLE" in content
    assert "verifyNativeMethod" in content or "invokeNative" in content


def test_api_js_covers_all_core_domains():
    """Verify that all core functional domains are registered in the dispatch table."""
    content = API_JS_PATH.read_text(encoding="utf-8")

    expected_routes_or_patterns = [
        "/api/connections",
        "/api/connections/fetch-metadata",
        "/api/connections/check-credential",
        "/api/connections/clear-credential",
        "/api/query/execute",
        "/api/query/cancel",
        "/api/query/explain",
        "/api/query/syntax-check",
        "/api/tx/begin",
        "/api/tx/commit",
        "/api/tx/rollback",
        "/api/tx/status",
        "/api/table-data-editor/metadata",
        "/api/table-data-editor/fetch",
        "/api/table-data-editor/update",
        "/api/table-data-editor/delete",
        "/api/table-data-editor/insert",
        "/api/profiler/connections",
        "/api/bravo/config",
        "/api/history/log_execution",
        "/api/postgresql/dependency/",
        "/api/sql/object-search",
        "/api/sql/object-ddl",
        "/api/grid/open-excel",
        "/api/system/fonts",
        "/api/system/logs/open",
    ]

    for route in expected_routes_or_patterns:
        assert route in content, f"Route/pattern {route} missing from api.js dispatch table"


def test_api_js_preserves_linked_server_bridge_assertions():
    """Ensure compatibility with assertions in tests/test_linked_server_bridge.py."""
    content = API_JS_PATH.read_text(encoding="utf-8")

    assert "action === 'linked_servers'" in content
    assert "api.get_linked_servers(connId)" in content
    assert "action === 'linked_server'" in content
    assert "subAction === 'databases'" in content
    assert "subAction === 'test'" in content
    assert "subAction === 'script'" in content
    assert "subAction === 'drop'" in content


def test_api_js_explicit_method_missing_handling():
    """Verify that missing methods produce clear error and 501 status."""
    content = API_JS_PATH.read_text(encoding="utf-8")

    # Check that not implemented error message is explicit
    assert "is not implemented on pywebview bridge" in content or "not supported by native api" in content
    # Check that HTTP 501 is returned when not implemented
    assert "501" in content


def test_dist_sync_api_js():
    """Verify that static/js/api.js is in sync with dist/LLTool/_internal/static/js/api.js."""
    assert API_JS_PATH.exists()
    assert DIST_API_JS_PATH.exists()
    src_content = API_JS_PATH.read_text(encoding="utf-8")
    dist_content = DIST_API_JS_PATH.read_text(encoding="utf-8")
    assert src_content == dist_content, "dist/LLTool/_internal/static/js/api.js is out of sync with static/js/api.js"
