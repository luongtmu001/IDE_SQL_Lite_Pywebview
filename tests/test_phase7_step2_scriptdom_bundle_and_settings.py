# -*- coding: utf-8 -*-
"""
tests/test_phase7_step2_scriptdom_bundle_and_settings.py:
Unit tests verifying Microsoft ScriptDOM DLL bundling and settings configuration.
"""
import os
from unittest.mock import patch
import pytest
from app.database.syntax.adapters.sqlserver_scriptdom import SqlServerScriptDomAdapter


def test_scriptdom_bundled_dll_loaded_by_default():
    """Verify default instantiation locates the bundled DLL in app/database/syntax/bin."""
    adapter = SqlServerScriptDomAdapter()
    assert adapter._dll_path is not None, "ScriptDOM DLL path must be located"
    assert "Microsoft.SqlServer.TransactSql.ScriptDom.dll" in adapter._dll_path
    assert adapter.is_available is True, "ScriptDOM adapter must be available on Windows"


def test_scriptdom_get_status_structure():
    """Verify get_status returns dictionary with availability, bundle flag, and path."""
    adapter = SqlServerScriptDomAdapter()
    status = adapter.get_status()
    assert isinstance(status, dict)
    assert status["is_available"] is True
    assert status["dll_path"] is not None
    assert status["is_bundled"] is True
    assert status["error"] is None


def test_scriptdom_custom_path_override():
    """Verify custom_dll_path argument overrides default search."""
    dummy_nonexistent = r"C:\nonexistent_path\dummy_scriptdom.dll"
    adapter = SqlServerScriptDomAdapter(custom_dll_path=dummy_nonexistent)
    assert adapter.is_available is False
    assert adapter._dll_path is None
    assert adapter._init_error is not None
    status = adapter.get_status()
    assert status["is_available"] is False


def test_scriptdom_settings_store_path_configuration(tmp_path):
    """Verify settings.json syntax.scriptDomDllPath is respected if valid."""
    fake_dll = tmp_path / "Microsoft.SqlServer.TransactSql.ScriptDom.dll"
    fake_dll.write_text("dummy dll binary content", encoding="utf-8")

    fake_settings = {
        "syntax": {
            "scriptDomDllPath": str(fake_dll)
        }
    }

    with patch("app.services.settings_store.load_settings", return_value=fake_settings):
        adapter = SqlServerScriptDomAdapter.__new__(SqlServerScriptDomAdapter)
        # It should locate the fake_dll from settings
        assert adapter._locate_dll() == str(fake_dll)
