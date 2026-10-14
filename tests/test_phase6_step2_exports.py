# -*- coding: utf-8 -*-
"""
Tests for Phase 6 Step 2: Extracted export utilities:
- app.desktop.exports.grid_open_in_excel
- app.desktop.exports.grid_save_results_as
"""
import os
import tempfile
from unittest.mock import MagicMock, patch
import pytest

from app.desktop.exports import grid_open_in_excel, grid_save_results_as


def test_grid_open_in_excel_creates_file():
    columns = ["ID", "Name", "Score"]
    rows = [[1, "Alpha", 100], [2, "Beta", None]]

    # Mock os.startfile so it does not actually spawn Excel during unit testing
    with patch("os.startfile") as mock_startfile:
        res = grid_open_in_excel(columns, rows)
        assert res["success"] is True
        assert "file_path" in res
        export_file = res["file_path"]
        assert os.path.exists(export_file)
        mock_startfile.assert_called_once_with(export_file)

        # Cleanup created temporary file
        try:
            # Clear read-only if set
            os.chmod(export_file, 0o666)
            os.remove(export_file)
        except Exception:
            pass


def test_grid_save_results_as_cancel():
    mock_win = MagicMock()
    mock_win.create_file_dialog.return_value = None

    res = grid_save_results_as(columns=["col1"], rows=[[1]], default_filename="test.xlsx", window=mock_win)
    assert res.get("cancelled") is True
    assert res.get("success") is False


def test_grid_save_results_as_csv(tmp_path):
    target_file = str(tmp_path / "output.csv")
    mock_win = MagicMock()
    mock_win.create_file_dialog.return_value = [target_file]

    columns = ["A", "B"]
    rows = [[10, "Hello"], [20, "World"]]

    res = grid_save_results_as(columns=columns, rows=rows, window=mock_win)
    assert res.get("success") is True
    assert res.get("saved_path") == target_file
    assert os.path.exists(target_file)

    with open(target_file, "r", encoding="utf-8-sig") as f:
        content = f.read()
    assert "A,B" in content
    assert "10,Hello" in content
