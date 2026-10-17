# -*- coding: utf-8 -*-
"""
Tests for Central Version Management & Update Checker Service (Roadmap Item 6.2).
"""
import io
import json
import urllib.request
import urllib.error
from unittest.mock import MagicMock, patch

import pytest
from app.version import (
    __version__,
    __version_tuple__,
    __app_name__,
    get_version,
    get_app_info,
    parse_semver,
    compare_versions,
)
from app.services.update_checker import (
    check_for_updates,
    get_cached_update_info,
    start_background_check,
)
from app.api.settings_api import SettingsApiMixin


def test_version_metadata():
    """Verify version string, tuple, and get_version() consistency."""
    assert __version__ == "1.0.0"
    assert __version_tuple__ == (1, 0, 0)
    assert get_version() == "1.0.0"
    assert "luoBTool" in __app_name__


def test_semver_parsing_and_comparison():
    """Verify robust semver parsing across standard, prefixed, and pre-release formats."""
    assert parse_semver("1.0.0") == (1, 0, 0)
    assert parse_semver("v1.2.3") == (1, 2, 3)
    assert parse_semver("V2.10.4-beta.1") == (2, 10, 4)
    assert parse_semver("3.4") == (3, 4, 0)
    assert parse_semver("") == (0, 0, 0)
    assert parse_semver(None) == (0, 0, 0)

    # Comparison tests
    assert compare_versions("1.0.1", "1.0.0") == 1
    assert compare_versions("1.0.0", "1.0.1") == -1
    assert compare_versions("1.0.0", "1.0.0") == 0
    assert compare_versions("v1.2.0", "1.1.9") == 1
    assert compare_versions("2.0.0", "1.99.99") == 1
    assert compare_versions("1.0.0-rc1", "1.0.0") == 0


def test_get_app_info():
    """Verify get_app_info returns complete runtime dictionary."""
    info = get_app_info()
    assert info["version"] == "1.0.0"
    assert "appName" in info
    assert "isPortable" in info
    assert "userDataDir" in info
    assert "appDir" in info
    assert "pythonVersion" in info
    assert "platform" in info


def test_update_checker_newer_version():
    """Verify update checker detects newer remote version correctly."""
    mock_payload = json.dumps({
        "version": "1.2.0",
        "releaseDate": "2026-11-01",
        "downloadUrl": "https://github.com/test/release/v1.2.0",
        "releaseNotes": "Major bug fixes and new features.",
        "highlights": ["New feature A", "Improvement B"]
    }).encode("utf-8")

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = mock_payload
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = check_for_updates(force=True, custom_url="http://test.local/version.json")
        assert res["success"] is True
        assert res["hasUpdate"] is True
        assert res["latestVersion"] == "1.2.0"
        assert res["currentVersion"] == __version__
        assert len(res["highlights"]) == 2
        assert "v1.2.0" in res["downloadUrl"]


def test_update_checker_up_to_date():
    """Verify update checker recognizes when current version is latest."""
    mock_payload = json.dumps({
        "version": "1.0.0",
        "releaseDate": "2026-10-16",
        "downloadUrl": "https://github.com/test/release/v1.0.0",
        "releaseNotes": "Current version",
        "highlights": []
    }).encode("utf-8")

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = mock_payload
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = check_for_updates(force=True, custom_url="http://test.local/version.json")
        assert res["success"] is True
        assert res["hasUpdate"] is False
        assert res["latestVersion"] == "1.0.0"


def test_update_checker_network_error_graceful():
    """Verify update checker handles network errors without crashing."""
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("DNS resolution failed")):
        res = check_for_updates(force=True, custom_url="http://invalid.domain/version.json")
        assert res["success"] is False
        assert res["hasUpdate"] is False
        assert res["error"] is not None
        assert "DNS resolution failed" in res["error"]


def test_settings_api_version_methods():
    """Verify SettingsApiMixin exposes version and update APIs."""
    api = SettingsApiMixin()

    v_res = api.get_app_version()
    assert v_res["success"] is True
    assert v_res["data"]["version"] == "1.0.0"

    with patch("app.services.update_checker.check_for_updates") as mock_check:
        mock_check.return_value = {"success": True, "hasUpdate": False, "latestVersion": "1.0.0"}
        u_res = api.check_for_updates(force=True)
        assert u_res["success"] is True
        assert u_res["data"]["latestVersion"] == "1.0.0"

    with patch("webbrowser.open") as mock_wb:
        url_res = api.open_external_url("https://github.com/releases")
        assert url_res["success"] is True
        mock_wb.assert_called_once_with("https://github.com/releases")

    # Invalid URL scheme rejected safely
    bad_url_res = api.open_external_url("javascript:alert(1)")
    assert bad_url_res["success"] is False


def test_download_update_flow(tmp_path):
    """Verify in-app download flow with progress tracking and file completion."""
    from app.services.update_checker import (
        start_download_update,
        get_download_progress,
        cancel_download,
        open_downloaded_file,
        open_containing_folder,
    )

    content = b"PK_FAKE_ZIP_CONTENT_FOR_TESTING" * 50
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.headers = {"Content-Length": str(len(content))}
    mock_resp.read.side_effect = [content[:500], content[500:], b""]

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = start_download_update(
            download_url="https://example.com/test_update.zip",
            file_name="test_update.zip",
            target_dir=str(tmp_path),
            total_bytes_hint=len(content),
        )
        assert res["success"] is True
        assert res["status"] == "downloading"

        # Wait briefly for thread to finish
        import time
        time.sleep(0.3)

        prog = get_download_progress()
        assert prog["status"] == "completed"
        assert prog["progress"] == 100.0
        assert (tmp_path / "test_update.zip").exists()
        assert (tmp_path / "test_update.zip").read_bytes() == content

    # Test open_downloaded_file with mock
    with patch("os.startfile") as mock_startfile:
        op_res = open_downloaded_file(str(tmp_path / "test_update.zip"))
        assert op_res["success"] is True
        mock_startfile.assert_called_once_with(str(tmp_path / "test_update.zip"))

    # Test open_containing_folder with mock
    with patch("subprocess.Popen") as mock_popen:
        fold_res = open_containing_folder(str(tmp_path / "test_update.zip"))
        assert fold_res["success"] is True
        mock_popen.assert_called_once()

