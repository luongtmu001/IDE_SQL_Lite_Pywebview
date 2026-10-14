# -*- coding: utf-8 -*-
import os
import sys
import logging
import tempfile
import threading
from pathlib import Path
import pytest

from app.utils.logging_setup import (
    SensitiveDataFilter,
    setup_logging,
    close_logging,
    get_log_info,
    update_log_level,
    open_log_folder,
    set_custom_log_dir,
    get_log_file_path,
)


@pytest.fixture(autouse=True)
def clean_logging():
    yield
    close_logging()


def test_sensitive_data_filter_masking():
    filtr = SensitiveDataFilter()
    
    # Test password masking
    sample1 = "Connecting with password=super_secret_123 to server"
    masked1 = filtr.mask_sensitive(sample1)
    assert "***REDACTED***" in masked1
    assert "super_secret_123" not in masked1

    # Test pwd masking
    sample2 = "User login: pwd='MySecretPassword!';"
    masked2 = filtr.mask_sensitive(sample2)
    assert "***REDACTED***" in masked2
    assert "MySecretPassword!" not in masked2

    # Test JSON masking
    sample3 = '{"username": "admin", "password": "SecretJsonPassword123"}'
    masked3 = filtr.mask_sensitive(sample3)
    assert '"password": "***REDACTED***"' in masked3
    assert "SecretJsonPassword123" not in masked3

    # Test token masking
    sample4 = 'Token received: auth_token="eyJhbGciOi..."'
    masked4 = filtr.mask_sensitive(sample4)
    assert "***REDACTED***" in masked4
    assert "eyJhbGciOi..." not in masked4

    # Test URI connection string masking (including passwords with @ or special chars)
    sample5 = "postgresql://myuser:P@ssw0rd123@localhost:5432/mydb"
    masked5 = filtr.mask_sensitive(sample5)
    assert "postgresql://myuser:***REDACTED***@localhost:5432/mydb" in masked5

    # Test ADO.NET connection string masking
    sample6 = "Server=myServerAddress;Database=myDataBase;Uid=myUsername;Pwd=myPassword;"
    masked6 = filtr.mask_sensitive(sample6)
    assert "Pwd=***REDACTED***;" in masked6
    assert "myPassword" not in masked6


def test_logging_setup_and_rotation():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        try:
            # Small maxBytes to trigger quick rotation (e.g. 600 bytes)
            logger = setup_logging(
                log_dir=tmp_path,
                level_name="DEBUG",
                max_bytes=600,
                backup_count=3,
                enable_console=False
            )
            
            # Write some logs
            for i in range(50):
                logger.info("This is test log line number %d with some padding text to fill the buffer", i)
            
            log_file = tmp_path / "app.log"
            assert log_file.exists(), "app.log should be created"
            
            # Check that rotated files exist
            rotated_files = list(tmp_path.glob("app.log*"))
            assert len(rotated_files) > 1, f"Expected rotated files, got: {rotated_files}"

            # Check diagnostics info
            info = get_log_info()
            assert info["file_exists"] is True
            assert info["current_level"] == "DEBUG"
            assert len(info["files"]) >= 1
        finally:
            close_logging()


def test_update_log_level():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        try:
            setup_logging(log_dir=tmp_path, level_name="INFO", enable_console=False)
            
            assert update_log_level("WARNING") is True
            assert logging.getLogger().level == logging.WARNING
            
            assert update_log_level("INVALID_LEVEL") is False
            assert logging.getLogger().level == logging.WARNING
        finally:
            close_logging()


def test_open_log_folder_path_resolution(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        set_custom_log_dir(tmp_path)
        
        called = []
        if sys.platform == "win32":
            monkeypatch.setattr(os, "startfile", lambda p: called.append(p))
        else:
            monkeypatch.setattr("subprocess.Popen", lambda args: called.append(args))
            
        res = open_log_folder()
        assert res["success"] is True
        assert len(called) == 1
        assert str(tmp_path) in str(called[0])


def test_unhandled_exception_hooks():
    recorded_logs = []
    test_logger = logging.getLogger("luobtool.crash")
    
    class TestHandler(logging.Handler):
        def emit(self, record):
            recorded_logs.append(record)
            
    handler = TestHandler()
    test_logger.addHandler(handler)
    try:
        try:
            raise ValueError("Test uncaught exception")
        except ValueError:
            exc_info = sys.exc_info()
            sys.excepthook(*exc_info)
            
        assert len(recorded_logs) >= 1
        assert "Uncaught exception in main thread" in recorded_logs[-1].getMessage()
        assert "Test uncaught exception" in recorded_logs[-1].getMessage()
    finally:
        test_logger.removeHandler(handler)


def test_main_api_logging_integration(monkeypatch):
    from main import MainApi, SettingsSubwindowApi

    api = MainApi()
    sub_api = SettingsSubwindowApi(api)

    monkeypatch.setattr("app.utils.logging_setup.open_log_folder", lambda: {"success": True, "path": "D:/test/logs"})
    
    res1 = api.open_log_folder()
    assert res1["success"] is True
    assert res1["path"] == "D:/test/logs"

    res2 = sub_api.open_log_folder()
    assert res2["success"] is True
    assert res2["path"] == "D:/test/logs"

    info = api.get_log_info()
    assert info["success"] is True
    assert "log_dir" in info["data"]


def test_save_settings_updates_log_level(monkeypatch):
    from main import MainApi

    api = MainApi()
    # Mock save file and broadcast
    monkeypatch.setattr("main._save_settings_file", lambda s: True)
    monkeypatch.setattr(api, "_broadcast_settings", lambda s: None)

    api.save_settings({"logging": {"level": "ERROR"}})
    assert logging.getLogger().level == logging.ERROR

    api.save_settings({"logging": {"level": "INFO"}})
    assert logging.getLogger().level == logging.INFO

