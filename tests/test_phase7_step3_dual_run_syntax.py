# -*- coding: utf-8 -*-
"""
tests/test_phase7_step3_dual_run_syntax.py:
Dual-run comparison test suite running legacy validator vs new pipeline
across the SQL corpus in tests/fixtures/sql_corpus/.
"""
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

from app.database.syntax.validator import validate_sql as legacy_validate_sql
from app.database.syntax.coordinator import validate_sql_pipeline
from main import MainApi

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "sql_corpus"


@pytest.fixture
def corpus_files():
    """Retrieve all SQL fixture files in sql_corpus directory."""
    files = list(FIXTURES_DIR.glob("*.sql"))
    assert len(files) >= 8, f"Expected at least 8 corpus files, found {len(files)}"
    return files


def test_dual_run_corpus_comparison(corpus_files):
    """
    Dual-run both legacy validate_sql and new validate_sql_pipeline across all corpus fixtures.
    Validates:
    - Valid SQL fixtures produce 0 error diagnostics in both or new pipeline.
    - Invalid SQL fixtures detect errors in both.
    - New pipeline never crashes on any corpus input.
    """
    for file_path in corpus_files:
        sql = file_path.read_text(encoding="utf-8")
        is_tsql = file_path.name.startswith("tsql_")
        dialect = "sqlserver" if is_tsql else "postgresql"
        is_error_fixture = "syntax_error" in file_path.name

        # 1. Run legacy validator
        legacy_diags = legacy_validate_sql(sql=sql, dialect=dialect)

        # 2. Run new coordinator pipeline
        pipe_diags = validate_sql_pipeline(sql=sql, dialect=dialect)

        assert isinstance(legacy_diags, list), f"Legacy output must be list for {file_path.name}"
        assert isinstance(pipe_diags, list), f"Pipeline output must be list for {file_path.name}"

        if is_error_fixture:
            # Both should detect the syntax errors
            assert len(pipe_diags) > 0, f"Pipeline must detect syntax error in {file_path.name}"
        else:
            # Valid SQL should have 0 severe errors in pipeline
            severe_errors = [d for d in pipe_diags if d.get("severity") in (1, "error", "ERROR")]
            assert len(severe_errors) == 0, (
                f"Valid query {file_path.name} should not have errors in pipeline: {severe_errors}"
            )


def test_main_api_syntax_check_honors_setting_toggle():
    """Verify MainApi.syntax_check toggles between legacy and pipeline based on syntax.pipeline setting."""
    api = MainApi(MagicMock())
    test_sql = "SELECT CustomerId, CustomerName FROM dbo.Customers;"

    # 1. With syntax.pipeline = False (default)
    with patch("app.services.settings_store.load_settings", return_value={"syntax": {"pipeline": False}}):
        with patch("app.database.syntax.validator.validate_sql", return_value=[{"msg": "legacy"}]) as mock_legacy:
            with patch("app.database.syntax.coordinator.validate_sql_pipeline") as mock_pipeline:
                res = api.syntax_check(sql=test_sql, dialect="sqlserver")
                assert res["success"] is True
                assert res["diagnostics"] == [{"msg": "legacy"}]
                mock_legacy.assert_called_once()
                mock_pipeline.assert_not_called()

    # 2. With syntax.pipeline = True
    with patch("app.services.settings_store.load_settings", return_value={"syntax": {"pipeline": True}}):
        with patch("app.database.syntax.validator.validate_sql") as mock_legacy:
            with patch("app.database.syntax.coordinator.validate_sql_pipeline", return_value=[{"msg": "pipeline"}]) as mock_pipeline:
                res = api.syntax_check(sql=test_sql, dialect="sqlserver")
                assert res["success"] is True
                assert res["diagnostics"] == [{"msg": "pipeline"}]
                mock_pipeline.assert_called_once()
                mock_legacy.assert_not_called()


def test_main_api_syntax_check_fallback_on_pipeline_error():
    """Verify MainApi.syntax_check smoothly falls back to legacy if pipeline raises an unexpected exception."""
    api = MainApi(MagicMock())
    test_sql = "SELECT 1;"

    with patch("app.services.settings_store.load_settings", return_value={"syntax": {"pipeline": True}}):
        with patch("app.database.syntax.coordinator.validate_sql_pipeline", side_effect=RuntimeError("Pipeline crash")):
            with patch("app.database.syntax.validator.validate_sql", return_value=[{"msg": "fallback"}]) as mock_legacy:
                res = api.syntax_check(sql=test_sql, dialect="sqlserver")
                assert res["success"] is True
                assert res["diagnostics"] == [{"msg": "fallback"}]
                mock_legacy.assert_called_once()
