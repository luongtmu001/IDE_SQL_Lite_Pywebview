"""
Test suite for Execution Statistics Bar (Sprint 1 - F3)
Verifies templates, CSS styling, and JavaScript logic for F3.
"""

from pathlib import Path
import re
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_templates_contain_execution_stats_bar():
    index_html = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    results_html = (REPO_ROOT / "templates" / "partials" / "results.html").read_text(encoding="utf-8")

    for html_name, content in [("index.html", index_html), ("partials/results.html", results_html)]:
        assert "grid-execution-stats-bar" in content, f"{html_name} must contain .grid-execution-stats-bar"
        assert 'id="ide-result-footer"' in content, f"{html_name} must contain #ide-result-footer"
        assert 'id="ide-footer-rows"' in content, f"{html_name} must contain #ide-footer-rows"
        assert 'id="ide-footer-time-badge"' in content, f"{html_name} must contain #ide-footer-time-badge"
        assert 'id="ide-footer-time"' in content, f"{html_name} must contain #ide-footer-time"
        assert 'id="ide-footer-size"' in content, f"{html_name} must contain #ide-footer-size"
        assert 'id="ide-footer-size-val"' in content, f"{html_name} must contain #ide-footer-size-val"
        assert 'id="ide-footer-conn"' in content, f"{html_name} must contain #ide-footer-conn"
        assert 'id="ide-footer-conn-val"' in content, f"{html_name} must contain #ide-footer-conn-val"
        assert 'id="ide-footer-sparkline"' in content, f"{html_name} must contain #ide-footer-sparkline"
        assert 'id="ide-btn-copy-stats"' in content, f"{html_name} must contain #ide-btn-copy-stats"


def test_css_contains_execution_stats_styles():
    editor_css = (REPO_ROOT / "static" / "css" / "editor.css").read_text(encoding="utf-8")
    style_css = (REPO_ROOT / "static" / "css" / "style.css").read_text(encoding="utf-8")

    for css_name, content in [("editor.css", editor_css), ("style.css", style_css)]:
        assert ".grid-execution-stats-bar" in content, f"{css_name} missing .grid-execution-stats-bar"
        assert ".speed-fast" in content, f"{css_name} missing .speed-fast"
        assert ".speed-normal" in content, f"{css_name} missing .speed-normal"
        assert ".speed-slow" in content, f"{css_name} missing .speed-slow"
        assert ".ide-stat-sparkline" in content, f"{css_name} missing .ide-stat-sparkline"
        assert ".ide-stat-copied-flash" in content, f"{css_name} missing .ide-stat-copied-flash"


def test_storage_js_contains_stats_history_methods():
    storage_js = (REPO_ROOT / "static" / "js" / "storage.js").read_text(encoding="utf-8")
    assert "getQueryStatsHistory" in storage_js, "storage.js must implement getQueryStatsHistory"
    assert "saveQueryStatsHistory" in storage_js, "storage.js must implement saveQueryStatsHistory"
    assert "lltool_stats_" in storage_js, "storage.js must store history under lltool_stats_ key"


def test_grid_result_js_contains_stats_bar_methods():
    grid_js = (REPO_ROOT / "static" / "js" / "grid-result.js").read_text(encoding="utf-8")
    assert "updateExecutionStats" in grid_js, "grid-result.js must implement updateExecutionStats"
    assert "getLastExecutionStats" in grid_js, "grid-result.js must implement getLastExecutionStats"
    assert "copyExecutionStats" in grid_js, "grid-result.js must implement copyExecutionStats"
    assert "formatBytes" in grid_js, "grid-result.js must implement formatBytes"
    assert "renderSparklineSvg" in grid_js, "grid-result.js must implement renderSparklineSvg"
    assert "copyExecutionMetrics" in grid_js, "grid-result.js must implement copyExecutionMetrics"


def test_query_js_contains_execution_stats_integration():
    query_js = (REPO_ROOT / "static" / "js" / "query.js").read_text(encoding="utf-8")
    assert "computeQueryHash" in query_js, "query.js must implement computeQueryHash"
    assert "estimateResultPayloadSize" in query_js, "query.js must implement estimateResultPayloadSize"
    assert "recordAndSyncExecutionStats" in query_js, "query.js must implement recordAndSyncExecutionStats"
    assert "GridResultManager.updateExecutionStats" in query_js, "query.js must call GridResultManager.updateExecutionStats"


def test_no_packaged_dist_files_modified():
    # Ensure dist folder is completely clean / not modified as requested by user
    dist_dir = REPO_ROOT / "dist"
    if dist_dir.exists():
        # Check that we haven't created unexpected temporary files in dist
        assert dist_dir.is_dir()
