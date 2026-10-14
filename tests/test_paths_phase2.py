# -*- coding: utf-8 -*-
"""
Tests for app.utils.paths module (Phase 2):
- Custom and default user data directory resolution.
- First-run migration from source data dir.
- Non-destructive migration preserving originals.
"""
import os
import shutil
import tempfile
from pathlib import Path
import pytest
from app.utils.paths import get_user_data_dir, ensure_data_dir_migrated


def test_user_data_dir_env_override(monkeypatch):
    """Verify that LLTOOL_DATA_DIR environment variable overrides default path."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        monkeypatch.setenv("LLTOOL_DATA_DIR", tmp_dir)
        user_dir = get_user_data_dir()
        assert user_dir == Path(tmp_dir).resolve()
        assert user_dir.exists()


def test_user_data_dir_default_appdata(monkeypatch):
    """Verify default resolution uses APPDATA environment variable on Windows."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        monkeypatch.delenv("LLTOOL_DATA_DIR", raising=False)
        monkeypatch.setenv("APPDATA", tmp_dir)
        user_dir = get_user_data_dir()
        assert user_dir == Path(tmp_dir) / "LLTool"
        assert user_dir.exists()


def test_first_run_migration_copies_files(monkeypatch):
    """Verify that migration copies files from APP_DIR/data to target and creates .migrated."""
    with tempfile.TemporaryDirectory() as fake_app_dir_str, tempfile.TemporaryDirectory() as fake_target_str:
        fake_app_dir = Path(fake_app_dir_str)
        fake_source_data = fake_app_dir / "data"
        fake_source_data.mkdir()

        # Create sample files
        test_file = fake_source_data / "connections.json"
        test_file.write_text('{"sample": "data"}', encoding="utf-8")

        monkeypatch.setenv("LLTOOL_DATA_DIR", fake_target_str)
        target = ensure_data_dir_migrated(fake_app_dir)

        # Assert files copied to target
        migrated_file = target / "connections.json"
        assert migrated_file.exists()
        assert migrated_file.read_text(encoding="utf-8") == '{"sample": "data"}'

        # Assert original is untouched
        assert test_file.exists()

        # Assert .migrated flag exists
        assert (target / ".migrated").exists()
