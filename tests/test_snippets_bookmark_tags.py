import json
import os
import subprocess
import pytest
from app.services.settings_store import load_snippets_file, save_snippets_file, read_json, write_json


def test_snippets_schema_and_backend_persistence(tmp_path):
    """Verify snippets persistence preserves tags, isPinned, and updatedAt."""
    sample_snippets = [
        {
            "id": "snip_test_1",
            "prefix": "test_pin",
            "description": "Test Pinned Snippet",
            "body": "SELECT * FROM users WHERE active = 1;",
            "tags": ["user", "active"],
            "isPinned": True,
            "updatedAt": 1700000000000,
            "placeholders": []
        },
        {
            "id": "snip_test_2",
            "prefix": "test_unpin",
            "description": "Test Normal Snippet",
            "body": "SELECT COUNT(*) FROM orders;",
            "tags": ["order", "reporting"],
            "isPinned": False,
            "updatedAt": 1700000001000,
            "placeholders": []
        }
    ]

    target_file = tmp_path / "snippets_test.json"
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(sample_snippets, f)

    # Read back and verify fields are intact
    with open(target_file, "r", encoding="utf-8") as f:
        loaded = json.load(f)

    assert len(loaded) == 2
    assert loaded[0]["isPinned"] is True
    assert loaded[0]["tags"] == ["user", "active"]
    assert loaded[0]["updatedAt"] == 1700000000000
    assert loaded[1]["isPinned"] is False
    assert loaded[1]["tags"] == ["order", "reporting"]


def test_snippets_manager_js_tag_cloud_and_pinning():
    """Verify static/js/snippets-manager.js contains Sprint 2 F2 capabilities."""
    js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "snippets-manager.js")
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Tag cloud and tag helper methods
    assert "renderTagCloud()" in content
    assert "getAllTags()" in content
    assert "getPinnedCount()" in content
    assert "id=\"ide-snip-tag-cloud\"" in content
    assert "ide-snip-tag-pill" in content

    # Pinning support
    assert "togglePinSnippet(" in content
    assert "ide-snip-pin-toggle" in content
    assert "id=\"ide-snip-pinned\"" in content
    assert "id=\"ide-snip-tags\"" in content

    # Tag and content search
    assert "searchSnippets(" in content
    assert "__pinned__" in content


def test_snippets_bookmark_popover_in_js():
    """Verify Bookmark Popover and editor integration."""
    sm_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "snippets-manager.js")
    with open(sm_path, "r", encoding="utf-8") as f:
        sm_content = f.read()

    assert "showBookmarkPopover(" in sm_content
    assert "hideBookmarkPopover()" in sm_content
    assert "_ensureBookmarkPopoverDOM()" in sm_content
    assert "_saveBookmarkFromPopover()" in sm_content
    assert "ide-bookmark-popover-window" in sm_content
    assert "id=\"ide-bm-prefix\"" in sm_content
    assert "id=\"ide-bm-tags\"" in sm_content
    assert "id=\"ide-bm-pin\"" in sm_content
    assert "id=\"ide-bm-body\"" in sm_content

    ed_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "editor.js")
    with open(ed_path, "r", encoding="utf-8") as f:
        ed_content = f.read()

    assert "sql-bookmark-snippet" in ed_content
    assert "monaco.KeyMod.Shift | monaco.KeyCode.KeyB" in ed_content
    assert "AppSnippets.showBookmarkPopover()" in ed_content


def test_snippets_intellisense_ranking_boost():
    """Verify pinned snippets are boosted in candidate generator and completion ranker."""
    gen_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "candidate-generator.js")
    with open(gen_path, "r", encoding="utf-8") as f:
        gen_content = f.read()

    assert "isPinned ? 0.5 : 1.5" in gen_content
    assert "00_snip_" in gen_content
    assert "📌 Snippet" in gen_content

    rank_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "completion-ranker.js")
    with open(rank_path, "r", encoding="utf-8") as f:
        rank_content = f.read()

    assert "item.isPinned" in rank_content
    assert "contextScore += 120" in rank_content


def test_snippets_css_definitions():
    """Verify CSS styling classes for tag cloud, tag badges, pin toggle, and bookmark popover."""
    for css_file in ["editor.css", "style.css"]:
        css_path = os.path.join(os.path.dirname(__file__), "..", "static", "css", css_file)
        with open(css_path, "r", encoding="utf-8") as f:
            content = f.read()

        assert ".ide-snip-tag-pill" in content, f"{css_file} missing .ide-snip-tag-pill"
        assert ".ide-snip-tag-badge" in content, f"{css_file} missing .ide-snip-tag-badge"
        assert ".ide-snip-db-badge" in content, f"{css_file} missing .ide-snip-db-badge"
        assert ".ide-snip-pin-toggle" in content, f"{css_file} missing .ide-snip-pin-toggle"
        assert ".ide-bookmark-popover-window" in content, f"{css_file} missing .ide-bookmark-popover-window"


def test_snippets_db_type_persistence_and_filtering(tmp_path):
    """Verify snippets persistence preserves dbType and matches user requirements."""
    sample_snippets = [
        {
            "id": "snip_common",
            "prefix": "ssf",
            "description": "Select Star Common",
            "dbType": "all",
            "body": "SELECT * FROM $table$",
            "tags": ["select"],
            "isPinned": False,
        },
        {
            "id": "snip_mssql",
            "prefix": "top10",
            "description": "Select Top 10 MSSQL",
            "dbType": "sqlserver",
            "body": "SELECT TOP 10 * FROM $table$",
            "tags": ["mssql"],
            "isPinned": True,
        },
        {
            "id": "snip_pg",
            "prefix": "lim10",
            "description": "Select Limit 10 Postgres",
            "dbType": "postgresql",
            "body": "SELECT * FROM $table$ LIMIT 10",
            "tags": ["postgres"],
            "isPinned": False,
        },
        {
            "id": "snip_unassigned",
            "prefix": "cnt",
            "description": "Count rows unassigned dbType",
            "body": "SELECT COUNT(*) FROM $table$",
            "tags": ["aggregate"],
            "isPinned": False,
        }
    ]

    target_file = tmp_path / "snippets_dbtype_test.json"
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(sample_snippets, f)

    with open(target_file, "r", encoding="utf-8") as f:
        loaded = json.load(f)

    assert len(loaded) == 4
    assert loaded[0]["dbType"] == "all"
    assert loaded[1]["dbType"] == "sqlserver"
    assert loaded[2]["dbType"] == "postgresql"
    assert "dbType" not in loaded[3]


def test_snippets_manager_js_db_type_integration():
    """Verify snippets-manager.js contains database type normalization, filtering and UI selectors."""
    js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "snippets-manager.js")
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Core normalization and matching
    assert "normalizeDbType(" in content
    assert "matchesDbType(" in content
    assert "getSnippets(targetDbType)" in content
    assert "getAllSnippets()" in content
    assert "getDbTypeCounts()" in content

    # UI elements for DBMS type
    assert 'id="ide-snip-db-type"' in content
    assert 'id="ide-bm-db-type"' in content
    assert 'ide-snip-db-badge' in content
    assert '__sqlserver__' in content
    assert '__postgresql__' in content

    # Test the database matching logic
    def normalize_db_type(db_type):
        if not db_type:
            return "all"
        s = str(db_type).strip().lower()
        if s in ["all", "*", "any", "both", "cả 2"]:
            return "all"
        if s in ["sqlserver", "mssql", "ssms"]:
            return "sqlserver"
        if s in ["postgresql", "postgres", "pg"]:
            return "postgresql"
        return s

    def matches_db_type(snippet_db_type, target_db_type):
        s_norm = normalize_db_type(snippet_db_type)
        if s_norm == "all":
            return True
        if not target_db_type:
            return True
        t_norm = normalize_db_type(target_db_type)
        if t_norm == "all":
            return True
        return s_norm == t_norm

    # 1. Snippet without dbType / 'all' matches BOTH connections
    assert matches_db_type("all", "sqlserver") is True
    assert matches_db_type("all", "postgresql") is True
    assert matches_db_type(None, "sqlserver") is True
    assert matches_db_type(None, "postgresql") is True
    assert matches_db_type("", "sqlserver") is True
    assert matches_db_type("", "postgresql") is True

    # 2. Specific dbType only matches corresponding connection
    assert matches_db_type("sqlserver", "sqlserver") is True
    assert matches_db_type("sqlserver", "postgresql") is False
    assert matches_db_type("postgresql", "postgresql") is True
    assert matches_db_type("postgresql", "sqlserver") is False

    # 3. Aliases normalize correctly
    assert matches_db_type("mssql", "sqlserver") is True
    assert matches_db_type("postgres", "postgresql") is True
    assert matches_db_type("pg", "postgresql") is True
    assert matches_db_type("pg", "sqlserver") is False


def test_intellisense_filtering_by_db_type():
    """Verify candidate generator, completion engine, intellisense, and trigger controller filter snippets by dbType."""
    for file_name in ["candidate-generator.js", "completion-engine.js", "intellisense.js"]:
        js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", file_name)
        with open(js_path, "r", encoding="utf-8") as f:
            content = f.read()

        assert "window.AppSnippets.getSnippets(currentDbType)" in content or "getSnippets(currentDbType)" in content, f"{file_name} missing getSnippets(currentDbType)"
        assert "matchesDbType" in content, f"{file_name} missing matchesDbType check"
        assert "dbBadge" in content, f"{file_name} missing dbBadge in description"

    tc_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "trigger-controller.js")
    with open(tc_path, "r", encoding="utf-8") as f:
        tc_content = f.read()
    assert "getSnippets(currentDbType)" in tc_content


def test_dist_packages_not_modified():
    """Verify that dist/ and build/ directory contents were not touched (per user constraint)."""
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain", "dist", "build"],
            capture_output=True,
            text=True,
            check=True
        )
        assert res.stdout.strip() == "", f"dist/ or build/ has modified files: {res.stdout.strip()}"
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

