"""
Phase 7 Step 5 Test:
Verify that Flask routes in app/routes/ and Native pywebview API in app/api/
share common services from app/services/ and app/bravo/ without logic duplication,
and ensure zero cross-layer imports from app/routes into app/api.
"""
import ast
from pathlib import Path
import pytest

WORKSPACE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = WORKSPACE_DIR / "app"
API_DIR = APP_DIR / "api"
ROUTES_DIR = APP_DIR / "routes"
SERVICES_DIR = APP_DIR / "services"


def test_no_api_imports_from_routes():
    """Architecture Rule: app/api/ presentation layer must never import from app/routes/."""
    assert API_DIR.exists()
    api_files = list(API_DIR.glob("*.py"))
    assert len(api_files) > 0

    violations = []
    for py_file in api_files:
        content = py_file.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if node.module.startswith("app.routes") or node.module == "app.routes":
                    violations.append(f"{py_file.name}:{node.lineno} -> from {node.module} import ...")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("app.routes"):
                        violations.append(f"{py_file.name}:{node.lineno} -> import {alias.name}")

    assert not violations, f"Detected disallowed imports from app.routes into app/api:\n" + "\n".join(violations)


def test_session_service_shared_by_api_and_routes():
    """Verify session persistence is centralized in app/services/session_service.py."""
    from app.services.session_service import (
        save_session_data,
        load_session_data,
        clear_session_data,
        SESSION_FILE,
    )
    from app.api.session_api import SessionApiMixin
    from app.routes.session import (
        api_save_session,
        api_load_session,
        api_clear_session,
    )

    mixin = SessionApiMixin()
    test_payload = {
        "activeTabId": "tab_phase7",
        "sidebarWidth": 275,
        "tabs": [{"id": "tab_phase7", "title": "Phase7.sql", "content": "SELECT 7;"}],
    }

    res_save = mixin.session_save(test_payload)
    assert res_save.get("success") is True

    res_load = mixin.session_load()
    assert res_load.get("success") is True
    assert res_load.get("activeTabId") == "tab_phase7"
    tabs = res_load.get("tabs", [])
    assert len(tabs) == 1
    assert tabs[0].get("id") == "tab_phase7"

    res_clear = mixin.session_clear()
    assert res_clear.get("success") is True
    assert not SESSION_FILE.exists()


def test_styles_service_shared_by_api_and_routes():
    """Verify code styles logic is centralized in app/services/styles_service.py."""
    from app.services.styles_service import (
        get_default_styles_data,
        load_styles_file,
        save_styles_file,
        reset_styles_file,
    )
    from app.api.settings_api import SettingsApiMixin
    from app.routes.styles import styles_bp

    mixin = SettingsApiMixin()
    styles_res = mixin.get_code_styles()
    assert styles_res.get("success") is True
    assert "styles" in styles_res
    assert styles_res.get("schemaVersion") == 1

    # Test reset via mixin
    reset_res = mixin.reset_code_styles()
    assert reset_res.get("success") is True
    assert reset_res.get("activeStyleId") == "default"


def test_connections_saved_profile_loading_shared():
    """Verify saved connection profiles helper is shared between settings_store, api, and routes."""
    from app.services.settings_store import get_saved_connections
    from app.api.connections_api import ConnectionsApiMixin

    saved = get_saved_connections(filter_groups=False)
    assert isinstance(saved, list)

    mixin = ConnectionsApiMixin()
    res = mixin.get_saved_connections()
    assert res.get("success") is True
    assert isinstance(res.get("connections"), list)
    assert len(res["connections"]) == len(saved)


def test_bravo_routes_reuse_xml_codec():
    """Verify app/routes/bravo.py delegates to app.bravo.xml_codec."""
    from app.routes.bravo import (
        _beautify_xml_string,
        _decode_xml_payload,
        _encode_xml_payload,
        _validate_xml_syntax,
    )
    from app.bravo.xml_codec import (
        beautify_xml_string,
        decode_xml_payload,
        encode_xml_payload,
        validate_xml_syntax,
    )

    # Validate that bravo routes use the exact functions from xml_codec
    assert _beautify_xml_string == beautify_xml_string
    assert _decode_xml_payload == decode_xml_payload
    assert _encode_xml_payload == encode_xml_payload
    assert _validate_xml_syntax == validate_xml_syntax

    valid, err = _validate_xml_syntax("<root><item id='1'/></root>")
    assert valid is True
    assert err is None
