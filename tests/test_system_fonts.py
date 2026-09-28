# -*- coding: utf-8 -*-
import pytest
from app.utils.system_fonts import get_system_fonts


def test_get_system_fonts_structure():
    fonts = get_system_fonts()
    assert isinstance(fonts, dict)
    assert "all" in fonts
    assert "ui" in fonts
    assert "monospace" in fonts

    assert len(fonts["all"]) > 0
    assert len(fonts["monospace"]) > 0
    assert "Segoe UI" in fonts["ui"] or "Arial" in fonts["ui"]
    assert "Consolas" in fonts["monospace"] or "JetBrains Mono" in fonts["monospace"]


def test_main_api_system_fonts():
    import sys
    from unittest.mock import MagicMock
    if "webview" not in sys.modules:
        try:
            import webview
        except ImportError:
            sys.modules["webview"] = MagicMock()

    from main import BravoApi
    api = BravoApi(MagicMock())
    res = api.get_system_fonts()
    assert isinstance(res, dict)
    assert res.get("success") is True
    assert "data" in res
    assert len(res["data"]["all"]) > 0


def test_flask_system_fonts_endpoint():
    try:
        from app import create_app
        flask_app = create_app()
        client = flask_app.test_client()
        resp = client.get("/api/system/fonts")
        assert resp.status_code == 200
        json_data = resp.get_json()
        assert json_data["success"] is True
        assert len(json_data["data"]["all"]) > 0
    except ImportError:
        pytest.skip("Flask not available in current environment")
