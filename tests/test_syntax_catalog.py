# -*- coding: utf-8 -*-
"""
Unit tests for Cross-Database Syntax Reference & Compare Catalog (Phase 1).
Validates schema rules, relational integrity, validator rejection behavior, and search queries.
"""
import pytest
from pathlib import Path

from app.services.syntax_catalog.models import (
    Concept,
    SyntaxEntry,
    MappingEntry,
    SourceEntry,
    CatalogManifest,
)
from app.services.syntax_catalog.validator import CatalogValidator
from app.services.syntax_catalog.service import SyntaxCatalogService


@pytest.fixture
def catalog_service():
    service = SyntaxCatalogService()
    service.load_catalog(force_reload=True)
    return service


def test_catalog_manifest_loaded(catalog_service):
    """Manifest must contain required versioning metadata."""
    manifest = catalog_service.get_manifest()
    assert manifest.get("catalog_version") == "1.0.0"
    assert "postgresql" in manifest.get("supported_databases", [])
    assert "sqlserver" in manifest.get("supported_databases", [])
    assert manifest.get("total_concepts") >= 8
    assert manifest.get("total_syntax_entries") >= 20
    assert manifest.get("total_mappings") >= 10
    assert manifest.get("total_sources") >= 14


def test_catalog_schema_validation_passes(catalog_service):
    """Real catalog files must pass all validation checks with zero errors."""
    manifest_raw = catalog_service._read_json("catalog_manifest.json")
    concepts_raw = catalog_service._read_json("concepts.json")
    syntax_raw = catalog_service._read_json("syntax_entries.json")
    mappings_raw = catalog_service._read_json("mappings.json")
    sources_raw = catalog_service._read_json("sources.json")

    bundle = {
        "manifest": manifest_raw,
        "concepts": concepts_raw,
        "syntax_entries": syntax_raw,
        "mappings": mappings_raw,
        "sources": sources_raw,
    }

    is_valid, errors = CatalogValidator.validate_catalog(bundle)
    assert is_valid, f"Catalog validation failed with errors: {errors}"
    assert errors == []


def test_validator_rejects_duplicate_id():
    """Validator must reject duplicates in any entity list."""
    bundle = {
        "manifest": {"catalog_version": "1.0", "updated_at": "2026-10-22"},
        "sources": [
            {
                "id": "src_1",
                "database": "postgresql",
                "title": "Title",
                "url": "https://www.postgresql.org/docs/current/index.html",
                "documentation_version": "16",
                "product_version": "16",
                "section": "Sec",
                "retrieved_at": "2026-10-22",
                "last_checked_at": "2026-10-22",
            },
            {
                "id": "src_1",  # Duplicate!
                "database": "sqlserver",
                "title": "Title 2",
                "url": "https://learn.microsoft.com/en-us/sql",
                "documentation_version": "2022",
                "product_version": "2022",
                "section": "Sec",
                "retrieved_at": "2026-10-22",
                "last_checked_at": "2026-10-22",
            },
        ],
    }
    is_valid, errors = CatalogValidator.validate_catalog(bundle)
    assert not is_valid
    assert any("Duplicate Source ID detected" in e for e in errors)


def test_validator_rejects_missing_conditions_for_conditional_mapping():
    """Conditional mappings must specify explicit conditions."""
    bundle = {
        "manifest": {"catalog_version": "1.0", "updated_at": "2026-10-22"},
        "sources": [
            {
                "id": "src_1",
                "database": "postgresql",
                "title": "Doc",
                "url": "https://www.postgresql.org/docs/current/index.html",
                "documentation_version": "16",
                "product_version": "16",
                "section": "Sec",
                "retrieved_at": "2026-10-22",
                "last_checked_at": "2026-10-22",
            }
        ],
        "concepts": [
            {
                "id": "c_1",
                "name": "Concept",
                "category": "query",
                "description": "Desc",
                "status": "verified",
            }
        ],
        "syntax_entries": [
            {
                "id": "s_1",
                "database": "postgresql",
                "syntax": "SYN1",
                "display_name": "S1",
                "category": "query",
                "description": "Desc",
                "source_ids": ["src_1"],
                "status": "verified",
            },
            {
                "id": "s_2",
                "database": "sqlserver",
                "syntax": "SYN2",
                "display_name": "S2",
                "category": "query",
                "description": "Desc",
                "source_ids": ["src_1"],
                "status": "verified",
            },
        ],
        "mappings": [
            {
                "id": "m_1",
                "concept_id": "c_1",
                "source_syntax_ids": ["s_1"],
                "target_syntax_ids": ["s_2"],
                "equivalence_level": "conditional",
                "conditions": "",  # Missing!
                "limitations": "Some limitations",
                "verification_status": "verified",
                "source_ids": ["src_1"],
            }
        ],
    }
    is_valid, errors = CatalogValidator.validate_catalog(bundle)
    assert not is_valid
    assert any("must explicitly specify 'conditions'" in e for e in errors)


def test_search_alias_tilde_returns_like(catalog_service):
    """Searching for '~~' must return PostgreSQL LIKE syntax entry."""
    results = catalog_service.search_catalog(query="~~", database="postgresql")
    assert len(results) >= 1
    found_syntax = [r["id"] for r in results]
    assert "pg_like" in found_syntax or "pg_tilde_tilde" in found_syntax


def test_ilike_is_not_marked_fully_equivalent_to_like(catalog_service):
    """ILIKE mapping to SQL Server LIKE must be 'conditional', not 'equivalent'."""
    mappings = catalog_service.get_mappings_for_syntax("pg_ilike")
    cross_db_mappings = [
        m for m in mappings if any(ts["database"] == "sqlserver" for ts in m["target_syntaxes"])
    ]
    assert len(cross_db_mappings) >= 1
    for m in cross_db_mappings:
        assert m["equivalence_level"] == "conditional"
        assert "Collation" in m["conditions"] or "LOWER" in m["conditions"]


def test_lateral_mapping_to_apply_is_verified_and_conditional(catalog_service):
    """LEFT JOIN LATERAL mapping to OUTER APPLY must be conditional with official sources."""
    mappings = catalog_service.get_mappings_for_syntax("pg_left_join_lateral")
    assert len(mappings) >= 1
    apply_mapping = next(m for m in mappings if "ms_outer_apply" in m["target_syntax_ids"])
    assert apply_mapping["equivalence_level"] == "conditional"
    assert apply_mapping["verification_status"] == "verified"
    assert "src_pg_queries_lateral" in apply_mapping["source_ids"]
    assert "src_ms_from_apply" in apply_mapping["source_ids"]
    assert "ON TRUE" in apply_mapping["conditions"]


def test_search_filtering_by_database_and_category(catalog_service):
    """Filter by database and category should properly narrow results."""
    pg_strings = catalog_service.search_catalog(database="postgresql", category="string")
    assert len(pg_strings) >= 4
    for item in pg_strings:
        assert item["database"] == "postgresql"
        assert item["category"] == "string"

    ms_paging = catalog_service.search_catalog(database="sqlserver", category="paging")
    assert len(ms_paging) >= 2
    for item in ms_paging:
        assert item["database"] == "sqlserver"
        assert item["category"] == "paging"


def test_compare_selection_detects_lateral(catalog_service):
    """compare_selection must detect LEFT JOIN LATERAL in query text and present OUTER APPLY mapping."""
    sql = "SELECT c.id, o.amount FROM customers c LEFT JOIN LATERAL (SELECT * FROM orders o WHERE o.cid = c.id) o ON TRUE;"
    res = catalog_service.compare_selection(sql, source_db="postgresql", target_db="sqlserver")
    assert res["success"] is True
    assert res["found"] is True
    assert len(res["matched_concepts"]) >= 1
    c_info = res["matched_concepts"][0]
    assert c_info["concept"]["id"] == "concept_lateral_subquery_join"
    # Ensure mapping references ms_outer_apply
    mappings = c_info["mappings"]
    assert any("ms_outer_apply" in m["target_syntax_ids"] for m in mappings)


def test_compare_selection_empty_or_unknown(catalog_service):
    """Unknown or empty SQL should return found=False with clear user message."""
    res_empty = catalog_service.compare_selection("", source_db="postgresql", target_db="sqlserver")
    assert res_empty["found"] is False

    res_unknown = catalog_service.compare_selection("SELECT 1 + 1 AS simple_sum;", source_db="postgresql", target_db="sqlserver")
    assert res_unknown["found"] is False
    assert "Chưa có mapping đã xác minh" in res_unknown["message"]


def test_syntax_catalog_api_mixin():
    """Verify SyntaxCatalogApiMixin methods return correct dictionary structures."""
    from app.api.syntax_catalog_api import SyntaxCatalogApiMixin

    api = SyntaxCatalogApiMixin()
    # 1. Manifest
    manifest_res = api.get_syntax_manifest()
    assert manifest_res["success"] is True
    assert manifest_res["manifest"]["catalog_version"] == "1.0.0"

    # 2. Search
    search_res = api.search_syntax_catalog(query="LATERAL", database="postgresql")
    assert search_res["success"] is True
    assert search_res["total"] >= 1
    assert any("lateral" in r["id"] for r in search_res["results"])

    # 3. Get single syntax entry
    entry_res = api.get_syntax_entry("pg_left_join_lateral")
    assert entry_res["success"] is True
    assert entry_res["entry"]["id"] == "pg_left_join_lateral"
    assert len(entry_res["mappings"]) >= 1

    # 4. Get concept
    concept_res = api.get_syntax_concept("concept_lateral_subquery_join")
    assert concept_res["success"] is True
    assert concept_res["concept"]["name"] == "Correlated Subqueries in FROM Clause (LATERAL / APPLY)"
    assert len(concept_res["mappings"]) >= 2

    # 5. Selection compare
    cmp_res = api.compare_syntax_selection("SELECT * FROM t LEFT JOIN LATERAL (...) x ON TRUE", "postgresql", "sqlserver")
    assert cmp_res["success"] is True
    assert cmp_res["found"] is True


def test_main_api_includes_syntax_catalog_methods():
    """Verify MainApi inherits SyntaxCatalogApiMixin and exposes all methods for pywebview."""
    from main import MainApi

    main_api = MainApi()
    assert hasattr(main_api, "search_syntax_catalog")
    assert hasattr(main_api, "get_syntax_entry")
    assert hasattr(main_api, "get_syntax_concept")
    assert hasattr(main_api, "get_syntax_manifest")
    assert hasattr(main_api, "compare_syntax_selection")
    assert hasattr(main_api, "open_syntax_reference_window")
    assert hasattr(main_api, "syntax_catalog_insert_to_editor")

    # Call method via MainApi
    res = main_api.search_syntax_catalog(query="LIKE", database="postgresql")
    assert res["success"] is True
    assert res["total"] >= 1


def test_open_syntax_reference_subwindow_creation():
    """Verify open_syntax_reference_window creates a pywebview window with correct template."""
    from unittest.mock import MagicMock, patch
    from main import MainApi

    main_api = MainApi()
    mock_win = MagicMock()

    with patch("webview.create_window", return_value=mock_win) as mock_create, \
         patch("app.desktop.windows.apply_dwm_titlebar_theme"):
        res = main_api.open_syntax_reference_window()
        assert res["success"] is True
        assert mock_create.called
        args, kwargs = mock_create.call_args
        assert "syntax_reference_window.html" in kwargs["url"]
        assert kwargs["width"] >= 1000
        assert kwargs["height"] >= 600
        assert "Tra cứu & Đối chiếu cú pháp" in kwargs["title"]


def test_compare_selection_presets_bidirectional(catalog_service):
    """Verify all 5 Preset scenarios match expected concepts bidirectionally."""
    # 1. LIMIT / OFFSET (PG -> MS)
    sql_pg_limit = "SELECT id, name FROM users ORDER BY created_at DESC LIMIT 50 OFFSET 100;"
    res1 = catalog_service.compare_selection(sql_pg_limit, "postgresql", "sqlserver")
    assert res1["found"] is True
    assert any(c["concept_id"] == "concept_paging_offset_fetch" for c in res1["matched_concepts"])

    # 1b. OFFSET FETCH (MS -> PG)
    sql_ms_fetch = "SELECT id, name FROM users ORDER BY created_at DESC OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY;"
    res1b = catalog_service.compare_selection(sql_ms_fetch, "sqlserver", "postgresql")
    assert res1b["found"] is True
    assert any(c["concept_id"] == "concept_paging_offset_fetch" for c in res1b["matched_concepts"])

    # 1c. TOP (MS -> PG)
    sql_ms_top = "SELECT TOP (10) id, name FROM users ORDER BY id;"
    res1c = catalog_service.compare_selection(sql_ms_top, "sqlserver", "postgresql")
    assert res1c["found"] is True
    assert any(c["concept_id"] == "concept_paging_offset_fetch" for c in res1c["matched_concepts"])

    # 2. STRING_AGG (PG -> MS)
    sql_pg_sagg = "SELECT dept, string_agg(name, ', ' ORDER BY name) FROM emps GROUP BY dept;"
    res2 = catalog_service.compare_selection(sql_pg_sagg, "postgresql", "sqlserver")
    assert res2["found"] is True
    assert any(c["concept_id"] == "concept_string_aggregation" for c in res2["matched_concepts"])

    # 2b. STRING_AGG (MS -> PG)
    sql_ms_sagg = "SELECT dept, STRING_AGG(name, ', ') WITHIN GROUP (ORDER BY name) FROM emps GROUP BY dept;"
    res2b = catalog_service.compare_selection(sql_ms_sagg, "sqlserver", "postgresql")
    assert res2b["found"] is True
    assert any(c["concept_id"] == "concept_string_aggregation" for c in res2b["matched_concepts"])

    # 3. LATERAL / APPLY (PG -> MS)
    sql_pg_lat = "SELECT * FROM d CROSS JOIN LATERAL (SELECT * FROM e WHERE e.did = d.id) sub;"
    res3 = catalog_service.compare_selection(sql_pg_lat, "postgresql", "sqlserver")
    assert res3["found"] is True
    assert any(c["concept_id"] == "concept_lateral_subquery_join" for c in res3["matched_concepts"])

    # 3b. APPLY (MS -> PG)
    sql_ms_apply = "SELECT * FROM d CROSS APPLY (SELECT * FROM e WHERE e.did = d.id) sub;"
    res3b = catalog_service.compare_selection(sql_ms_apply, "sqlserver", "postgresql")
    assert res3b["found"] is True
    assert any(c["concept_id"] == "concept_lateral_subquery_join" for c in res3b["matched_concepts"])

    # 3c. OUTER APPLY (MS -> PG)
    sql_ms_outer = "SELECT * FROM d OUTER APPLY (SELECT * FROM e WHERE e.did = d.id) sub;"
    res3c = catalog_service.compare_selection(sql_ms_outer, "sqlserver", "postgresql")
    assert res3c["found"] is True
    assert any(c["concept_id"] == "concept_lateral_subquery_join" for c in res3c["matched_concepts"])

    # 4. COALESCE / ISNULL (PG -> MS)
    sql_pg_coal = "SELECT id, COALESCE(phone, mobile, 'N/A') FROM contacts;"
    res4 = catalog_service.compare_selection(sql_pg_coal, "postgresql", "sqlserver")
    assert res4["found"] is True
    assert any(c["concept_id"] == "concept_null_fallback_coalesce" for c in res4["matched_concepts"])

    # 4b. ISNULL (MS -> PG)
    sql_ms_isnull = "SELECT id, ISNULL(phone, 'N/A') FROM contacts;"
    res4b = catalog_service.compare_selection(sql_ms_isnull, "sqlserver", "postgresql")
    assert res4b["found"] is True
    assert any(c["concept_id"] == "concept_null_fallback_coalesce" for c in res4b["matched_concepts"])

    # 5. ILIKE (PG -> MS)
    sql_pg_ilike = "SELECT * FROM products WHERE name ILIKE '%laptop%';"
    res5 = catalog_service.compare_selection(sql_pg_ilike, "postgresql", "sqlserver")
    assert res5["found"] is True
    assert any(c["concept_id"] == "concept_case_insensitive_pattern_matching" for c in res5["matched_concepts"])


def test_compare_selection_datetime_and_json(catalog_service):
    """Verify DateTime and JSON comparison detection."""
    # JSON arrow text ->> (PG -> MS)
    sql_pg_json = "SELECT id, payload ->> 'username' AS uname FROM events;"
    res_json = catalog_service.compare_selection(sql_pg_json, "postgresql", "sqlserver")
    assert res_json["found"] is True
    assert any(c["concept_id"] == "concept_json_scalar_extract" for c in res_json["matched_concepts"])

    # JSON_VALUE (MS -> PG)
    sql_ms_json = "SELECT id, JSON_VALUE(payload, '$.username') AS uname FROM events;"
    res_json_ms = catalog_service.compare_selection(sql_ms_json, "sqlserver", "postgresql")
    assert res_json_ms["found"] is True
    assert any(c["concept_id"] == "concept_json_scalar_extract" for c in res_json_ms["matched_concepts"])

    # CURRENT_TIMESTAMP (PG -> MS)
    sql_pg_dt = "SELECT CURRENT_TIMESTAMP, now();"
    res_dt = catalog_service.compare_selection(sql_pg_dt, "postgresql", "sqlserver")
    assert res_dt["found"] is True
    assert any(c["concept_id"] == "concept_current_timestamp" for c in res_dt["matched_concepts"])

    # GETDATE (MS -> PG)
    sql_ms_dt = "SELECT GETDATE() AS now_time;"
    res_dt_ms = catalog_service.compare_selection(sql_ms_dt, "sqlserver", "postgresql")
    assert res_dt_ms["found"] is True
    assert any(c["concept_id"] == "concept_current_timestamp" for c in res_dt_ms["matched_concepts"])


def test_open_syntax_reference_with_compare_selection_initial_filter():
    """Verify opening syntax reference window with selection passes initial_filter to JS API."""
    from unittest.mock import MagicMock, patch
    from main import MainApi

    main_api = MainApi()
    mock_win = MagicMock()
    initial_filter = {
        "view": "compare",
        "sql_text": "SELECT * FROM users ORDER BY id LIMIT 25 OFFSET 50;",
        "source_db": "postgresql",
        "target_db": "sqlserver",
    }

    with patch("webview.create_window", return_value=mock_win) as mock_create, \
         patch("app.desktop.windows.apply_dwm_titlebar_theme"):
        res = main_api.open_syntax_reference_window(initial_filter=initial_filter)
        assert res["success"] is True
        assert mock_create.called
        args, kwargs = mock_create.call_args
        js_api = kwargs["js_api"]
        assert js_api.get_initial_filter() == initial_filter


def test_open_syntax_reference_window_already_open_evaluates_js():
    """Verify that if window is already open, new selection context is pushed via evaluate_js."""
    from unittest.mock import MagicMock
    from main import MainApi
    from app.desktop.windows import open_syntax_reference_window

    main_api = MainApi()
    mock_existing_win = MagicMock()
    main_api._syntax_reference_window = mock_existing_win

    selection_filter = {
        "view": "compare",
        "sql_text": "SELECT TOP (10) * FROM accounts;",
        "source_db": "sqlserver",
        "target_db": "postgresql",
    }

    res = open_syntax_reference_window(main_api, initial_filter=selection_filter)
    assert res["success"] is True
    assert mock_existing_win.show.called
    assert mock_existing_win.focus.called
    assert mock_existing_win.evaluate_js.called
    eval_call = mock_existing_win.evaluate_js.call_args[0][0]
    assert "window.applyInitialContext" in eval_call
    assert "SELECT TOP (10) * FROM accounts;" in eval_call


def test_syntax_catalog_insert_to_editor_with_no_window():
    """Verify syntax_catalog_insert_to_editor returns failure if main window is absent."""
    from main import MainApi

    main_api = MainApi()
    main_api.window = None
    res = main_api.syntax_catalog_insert_to_editor("SELECT 1;")
    assert res["success"] is False
    assert "not available" in res["error"]


def test_catalog_graceful_fallback_when_dir_missing(tmp_path):
    """Verify service gracefully handles missing catalog directory without crashing."""
    from app.services.syntax_catalog.service import SyntaxCatalogService

    empty_dir = tmp_path / "nonexistent_catalog"
    svc = SyntaxCatalogService(catalog_dir=empty_dir)
    assert svc.load_catalog() is True
    # Searching should return empty list safely
    results = svc.search_catalog("ANYTHING")
    assert results == []
    # Compare should return clean not found
    cmp_res = svc.compare_selection("SELECT 1")
    assert cmp_res["found"] is False


def test_subwindow_multiple_open_close_lifecycle():
    """Verify multiple open/close cycles do not leak locks or duplicate windows."""
    from unittest.mock import MagicMock, patch
    from main import MainApi
    from app.desktop.windows import open_syntax_reference_window

    main_api = MainApi()

    for i in range(3):
        mock_win = MagicMock()
        with patch("webview.create_window", return_value=mock_win) as mock_create, \
             patch("app.desktop.windows.apply_dwm_titlebar_theme"):
            res = open_syntax_reference_window(main_api)
            assert res["success"] is True
            assert main_api._syntax_reference_window == mock_win

            # Simulate window closing
            main_api._syntax_reference_window = None
            assert main_api._syntax_reference_window is None


def test_validator_rejects_missing_target_syntax():
    """Verify validator flags mapping with syntax IDs that do not exist in syntax_entries."""
    bundle = {
        "manifest": {"catalog_version": "1.0"},
        "concepts": [{"id": "c1", "name": "Concept 1", "category": "query"}],
        "syntax_entries": [{"id": "s1", "name": "Syntax 1", "database": "postgresql", "category": "query"}],
        "mappings": [{
            "id": "m1",
            "concept_id": "c1",
            "source_syntax_ids": ["s1"],
            "target_syntax_ids": ["nonexistent_syntax_id"],
            "equivalence_level": "equivalent",
            "verification_status": "draft",
        }],
        "sources": [],
    }
    is_valid, errors = CatalogValidator.validate_catalog(bundle)
    assert not is_valid
    assert any("references non-existent target_syntax_id" in e for e in errors)


def test_compare_selection_string_concat_and_substring(catalog_service):
    """Verify detection and mapping for string concatenation (|| vs +/CONCAT) and substring (SUBSTR vs SUBSTRING)."""
    # 1. String Concat in PostgreSQL
    pg_concat_sql = "SELECT first_name || ' ' || last_name AS full_name FROM users;"
    res_pg = catalog_service.compare_selection(pg_concat_sql, "postgresql", "sqlserver")
    assert res_pg["success"] is True
    matched_ids = [c["concept_id"] for c in res_pg["matched_concepts"]]
    assert "concept_string_concat" in matched_ids

    # 2. String Substring in PostgreSQL
    pg_substr_sql = "SELECT SUBSTR(emp_code, 1, 3) FROM employees;"
    res_substr = catalog_service.compare_selection(pg_substr_sql, "postgresql", "sqlserver")
    assert res_substr["success"] is True
    assert any(c["concept_id"] == "concept_string_substring" for c in res_substr["matched_concepts"])


def test_compare_selection_string_length_trailing_spaces_gotcha(catalog_service):
    """Verify length detection and trailing spaces gotcha presence."""
    pg_len_sql = "SELECT LENGTH(user_input) FROM forms;"
    res = catalog_service.compare_selection(pg_len_sql, "postgresql", "sqlserver")
    assert res["success"] is True
    len_match = next((c for c in res["matched_concepts"] if c["concept_id"] == "concept_string_length"), None)
    assert len_match is not None
    # Must document trailing blanks gotcha in limitations or conditions
    all_notes = " ".join([m.get("limitations", "") + " " + m.get("notes", "") for m in len_match.get("mappings", [])])
    assert "trailing" in all_notes.lower() or "khoảng trắng" in all_notes.lower()


def test_compare_selection_datetime_dateadd_and_datetrunc(catalog_service):
    """Verify interval arithmetic and date truncation detection."""
    # 1. DateAdd Interval
    interval_sql = "SELECT created_at + INTERVAL '14 days' AS expiry FROM subscriptions;"
    res_int = catalog_service.compare_selection(interval_sql, "postgresql", "sqlserver")
    assert res_int["success"] is True
    assert any(c["concept_id"] == "concept_datetime_dateadd" for c in res_int["matched_concepts"])

    # 2. DateTrunc
    trunc_sql = "SELECT date_trunc('month', order_date), COUNT(*) FROM orders GROUP BY 1;"
    res_trunc = catalog_service.compare_selection(trunc_sql, "postgresql", "sqlserver")
    assert res_trunc["success"] is True
    assert any(c["concept_id"] == "concept_datetime_datetrunc" for c in res_trunc["matched_concepts"])


def test_compare_selection_type_casting_and_dml_returning(catalog_service):
    """Verify double-colon type casting and DML RETURNING clause detection."""
    # 1. Casting
    cast_sql = "SELECT id, user_id::text, amount::numeric(10,2) FROM orders;"
    res_cast = catalog_service.compare_selection(cast_sql, "postgresql", "sqlserver")
    assert res_cast["success"] is True
    assert any(c["concept_id"] == "concept_type_casting" for c in res_cast["matched_concepts"])

    # 2. DML RETURNING
    dml_sql = "INSERT INTO logs (action, user_id) VALUES ('login', 1) RETURNING id, created_at;"
    res_dml = catalog_service.compare_selection(dml_sql, "postgresql", "sqlserver")
    assert res_dml["success"] is True
    assert any(c["concept_id"] == "concept_dml_returning_output" for c in res_dml["matched_concepts"])


def test_compare_selection_random_and_regex(catalog_service):
    """Verify random() and regex ~ matching detection."""
    # 1. Random
    rand_sql = "SELECT id, name FROM prizes ORDER BY RANDOM() LIMIT 1;"
    res_rand = catalog_service.compare_selection(rand_sql, "postgresql", "sqlserver")
    assert res_rand["success"] is True
    assert any(c["concept_id"] == "concept_random_number" for c in res_rand["matched_concepts"])

    # 2. Regex Match
    regex_sql = "SELECT * FROM users WHERE email ~* '^[a-z0-9._%+-]+@';"
    res_regex = catalog_service.compare_selection(regex_sql, "postgresql", "sqlserver")
    assert res_regex["success"] is True
    assert any(c["concept_id"] == "concept_regex_matching" for c in res_regex["matched_concepts"])


def test_exclusive_syntax_entries_loaded(catalog_service):
    """Verify that exclusive statements are loaded with is_exclusive, workaround, and ai_insights."""
    pg_exclusives = [
        "pg_generate_series",
        "pg_on_conflict_upsert",
        "pg_distinct_on",
        "pg_array_construct_ops",
        "pg_anonymous_do_block",
        "pg_copy_command",
        "pg_listen_notify",
        "pg_regexp_split_to_table",
    ]
    ms_exclusives = [
        "ms_select_into_temp",
        "ms_merge_statement",
        "ms_table_variable",
        "ms_set_nocount",
        "ms_string_split",
        "ms_try_convert_parse",
        "ms_scope_identity",
        "ms_dbcc_checkdb",
    ]

    for sid in pg_exclusives + ms_exclusives:
        entry = catalog_service.get_syntax_entry(sid)
        assert entry is not None, f"Expected syntax entry {sid} to exist"
        assert entry.get("is_exclusive") is True, f"Expected {sid} to be marked is_exclusive=True"
        assert len(entry.get("workaround", "")) > 0, f"Expected {sid} to have a workaround"
        assert len(entry.get("ai_insights", "")) > 0, f"Expected {sid} to have ai_insights"


def test_exclusive_filtering_by_scope(catalog_service):
    """Verify search_catalog filtering by is_exclusive flag."""
    # 1. PostgreSQL Exclusive
    pg_excl = catalog_service.search_catalog(database="postgresql", is_exclusive=True)
    assert len(pg_excl) >= 8
    assert all(item.get("database") == "postgresql" and item.get("is_exclusive") is True for item in pg_excl)

    # 2. SQL Server Exclusive
    ms_excl = catalog_service.search_catalog(database="sqlserver", is_exclusive=True)
    assert len(ms_excl) >= 8
    assert all(item.get("database") == "sqlserver" and item.get("is_exclusive") is True for item in ms_excl)

    # 3. Mapped / Non-Exclusive only
    mapped = catalog_service.search_catalog(is_exclusive=False)
    assert len(mapped) >= 40
    assert all(item.get("is_exclusive") is not True for item in mapped)


def test_expanded_sources_w3schools_and_ai(catalog_service):
    """Verify presence and validity of W3Schools and AI sources in the catalog."""
    all_sources = catalog_service.get_sources()
    w3_sources = [s for s in all_sources if s.get("source_type") == "w3schools"]
    ai_sources = [s for s in all_sources if s.get("source_type") in ("ai", "ai_knowledge")]

    assert len(w3_sources) >= 5, f"Expected at least 5 W3Schools sources, found {len(w3_sources)}"
    assert len(ai_sources) >= 5, f"Expected at least 5 AI sources, found {len(ai_sources)}"
    assert any("w3schools.com" in s.get("url", "") for s in w3_sources)
    assert any("ai.luobtool.dev" in s.get("url", "") or "ai" in s.get("id", "") for s in ai_sources)


def test_compare_exclusive_syntax_statements(catalog_service):
    """Verify that detect_and_compare_syntax recognizes exclusive statements and returns guidance/workaround."""
    # 1. PostgreSQL generate_series
    gs_sql = "SELECT * FROM generate_series(1, 100);"
    res_gs = catalog_service.compare_selection(gs_sql, "postgresql", "sqlserver")
    assert res_gs["success"] is True
    assert res_gs["found"] is True
    assert any(
        "generate_series" in c.get("concept_id", "") or any("generate_series" in d.get("id", "") for d in c.get("detected_syntaxes", []))
        for c in res_gs["matched_concepts"]
    )

    # 2. SQL Server SELECT INTO #temp
    temp_sql = "SELECT id, name INTO #temp_users FROM users WHERE active = 1;"
    res_temp = catalog_service.compare_selection(temp_sql, "sqlserver", "postgresql")
    assert res_temp["success"] is True
    assert res_temp["found"] is True

    # 3. SQL Server MERGE
    merge_sql = "MERGE INTO target_table AS T USING source_table AS S ON T.id = S.id WHEN MATCHED THEN UPDATE SET T.v = S.v;"
    res_merge = catalog_service.compare_selection(merge_sql, "sqlserver", "postgresql")
    assert res_merge["success"] is True
    assert res_merge["found"] is True
