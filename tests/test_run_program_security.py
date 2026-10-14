# -*- coding: utf-8 -*-
"""
Tests for run_program and get_connection_password security (Phase 2):
- run_program rejects unknown IDs or empty IDs.
- run_program strictly refuses client-provided path injection.
- get_connection_password handles missing or encrypted profiles safely.
"""
import pytest
from unittest.mock import MagicMock, patch
from main import MainApi, connection_manager


@pytest.fixture
def api_instance():
    return MainApi(connection_manager)


def test_run_program_rejects_missing_or_empty_id(api_instance):
    """Verify run_program rejects calls with missing or empty program ID."""
    res1 = api_instance.run_program(None)
    assert res1["success"] is False

    res2 = api_instance.run_program({})
    assert res2["success"] is False

    res3 = api_instance.run_program({"id": ""})
    assert res3["success"] is False


def test_run_program_rejects_unknown_id(api_instance):
    """Verify run_program rejects non-existent program IDs."""
    res = api_instance.run_program({"id": "non_existent_id_99999"})
    assert res["success"] is False
    assert "Không tìm thấy chương trình" in res["error"]


def test_run_program_refuses_arbitrary_path_injection(api_instance):
    """Verify run_program does NOT execute arbitrary path provided by caller without valid stored ID."""
    res = api_instance.run_program({
        "id": "malicious_fake_id",
        "path": "C:\\Windows\\System32\\cmd.exe",
        "name": "Injected CMD"
    })
    assert res["success"] is False
    assert "Không tìm thấy chương trình" in res["error"]


def test_get_connection_password_safe(api_instance):
    """Verify get_connection_password returns empty password when profile not found."""
    res = api_instance.get_connection_password("non_existent_profile_xyz")
    assert res["success"] is True
    assert res["password"] == ""
