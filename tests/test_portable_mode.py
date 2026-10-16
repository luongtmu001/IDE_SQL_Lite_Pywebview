# -*- coding: utf-8 -*-
"""
Tests for Portable Mode & Cross-Machine Password Encryption (Roadmap Item 6.4).
"""
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from app.utils.paths import (
    is_portable_mode,
    set_portable_mode,
    get_user_data_dir,
    ensure_data_dir_migrated,
)
from app.utils.crypto import (
    encrypt_password,
    decrypt_password,
    CredentialDecryptError,
)
from app.api.settings_api import SettingsApiMixin


def test_portable_flag_detection():
    """Verify is_portable_mode detects portable.flag, portable.txt, and .portable."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_app = Path(tmp_dir)

        # Initially false
        assert is_portable_mode(fake_app) is False

        # With portable.flag
        flag_file = fake_app / "portable.flag"
        flag_file.write_text("portable=true", encoding="utf-8")
        assert is_portable_mode(fake_app) is True
        flag_file.unlink()

        # With .portable
        alt_flag = fake_app / ".portable"
        alt_flag.write_text("", encoding="utf-8")
        assert is_portable_mode(fake_app) is True
        alt_flag.unlink()

        # With portable.txt
        txt_flag = fake_app / "portable.txt"
        txt_flag.write_text("", encoding="utf-8")
        assert is_portable_mode(fake_app) is True


def test_set_portable_mode():
    """Verify set_portable_mode enables and disables cleanly."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_app = Path(tmp_dir)

        # Enable
        assert set_portable_mode(True, fake_app) is True
        assert (fake_app / "portable.flag").exists()
        assert (fake_app / "data").is_dir()
        assert is_portable_mode(fake_app) is True

        # Disable
        assert set_portable_mode(False, fake_app) is True
        assert not (fake_app / "portable.flag").exists()
        assert is_portable_mode(fake_app) is False


def test_get_user_data_dir_portable_resolution(monkeypatch):
    """Verify get_user_data_dir returns <app_dir>/data when portable mode is active."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_app = Path(tmp_dir)
        (fake_app / "portable.flag").write_text("portable=true", encoding="utf-8")

        monkeypatch.delenv("LLTOOL_DATA_DIR", raising=False)
        with patch("app.utils.paths.get_app_dir", return_value=fake_app):
            user_dir = get_user_data_dir()
            assert user_dir == (fake_app / "data").resolve()
            assert user_dir.exists()


def test_ensure_data_dir_migrated_portable_no_self_copy():
    """Verify that when target_dir == source_dir in portable mode, migration does not self-copy."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_app = Path(tmp_dir)
        portable_data = fake_app / "data"
        portable_data.mkdir()
        (portable_data / "connections.json").write_text('{"connections": []}', encoding="utf-8")

        with patch("app.utils.paths.get_app_dir", return_value=fake_app):
            with patch("app.utils.paths.get_user_data_dir", return_value=portable_data):
                result = ensure_data_dir_migrated(fake_app)
                assert result == portable_data
                assert (portable_data / ".migrated").exists()
                assert "portable" in (portable_data / ".migrated").read_text(encoding="utf-8")
                # Original file intact
                assert (portable_data / "connections.json").read_text(encoding="utf-8") == '{"connections": []}'


def test_crypto_portable_mode_prefers_fernet(monkeypatch):
    """
    Verify that in portable mode, password encryption prefers file-based Fernet (ENC2:F:)
    instead of Windows DPAPI so it can roam across computers and Windows user accounts.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_data = Path(tmp_dir) / "data"
        fake_data.mkdir()
        monkeypatch.setenv("LLTOOL_DATA_DIR", str(fake_data))

        with patch("app.utils.paths.is_portable_mode", return_value=True):
            password = "MyPortableSecretPass!99"
            encrypted = encrypt_password(password)

            # Portable encryption MUST use ENC2:F: (Fernet file key)
            assert encrypted.startswith("ENC2:F:")

            # Decryption round-trip succeeds
            decrypted = decrypt_password(encrypted)
            assert decrypted == password


def test_crypto_dpapi_fail_informative_error():
    """Verify that if DPAPI fails to decrypt, an informative message regarding portable roaming is raised."""
    # Malformed base64 DPAPI payload to force decryption error
    with pytest.raises(CredentialDecryptError) as exc_info:
        decrypt_password("ENC2:AAECAwQFBgcICQoLDA0ODw==")

    assert "DPAPI" in str(exc_info.value)
    assert "Portable" in str(exc_info.value)


def test_settings_api_portable_toggle():
    """Verify SettingsApiMixin exposes set_portable_mode API."""
    api = SettingsApiMixin()

    with patch("app.utils.paths.set_portable_mode", return_value=True) as mock_set:
        with patch("app.utils.paths.is_portable_mode", return_value=True):
            res = api.set_portable_mode(True)
            assert res["success"] is True
            assert res["isPortable"] is True
            mock_set.assert_called_once_with(True)
