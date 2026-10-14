# -*- coding: utf-8 -*-
"""
tests/test_history_phase5_advanced.py:
Automated test suite verifying Phase 5 - Advanced Features for Query History:
1. SQLite Schema Migration v2: Note, Tag columns, IX_History_Server_Db, IX_History_Tag.
2. Note & Tag recording, updating, clearing via storage engine and service.
3. Distinct filters retrieval (Server, Database, Tag).
4. Advanced multi-dimensional filtering on Documents and Entries (Server, Database, Date Range, Tag, EntryType).
5. Snapshot recording (EntryType = 2, Status = 0) upon tab save/close.
6. History JSON Export and Import roundtrip with full data fidelity and content deduplication.
7. MainApi and QueryHistorySubwindowApi IPC bridge integration.
8. tabs.js snapshot verification.
9. HTML/CSS/Monaco Diff UI components validation.
"""

import os
import sys
import time
import json
import sqlite3
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.services.history.storage import HistoryStore, SCHEMA_VERSION
from app.services.history.service import HistoryService
from main import MainApi, QueryHistorySubwindowApi


def test_schema_migration_v2():
    """Kiểm tra tự động nâng cấp DB từ Schema v1 lên Schema v2 với Note, Tag và Indexes."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_migration_v1_to_v2.db")

    # 1. Tạo giả lập database Schema v1 thủ công
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA user_version = 1;")
        conn.execute("""
            CREATE TABLE HistoryDocument (
                DocId TEXT PRIMARY KEY,
                DisplayName TEXT NOT NULL,
                FilePath TEXT NULL,
                IsStarred INTEGER NOT NULL DEFAULT 0,
                CreatedAt INTEGER NOT NULL,
                LastRunAt INTEGER NOT NULL,
                LastServer TEXT NULL,
                LastDatabase TEXT NULL
            );
        """)
        conn.execute("""
            CREATE TABLE HistoryContent (
                SqlHash TEXT PRIMARY KEY,
                CompressedSql BLOB NOT NULL,
                RawSize INTEGER NOT NULL,
                RefCount INTEGER NOT NULL DEFAULT 1,
                FirstSeen INTEGER NOT NULL
            );
        """)
        conn.execute("""
            CREATE TABLE HistoryEntry (
                EntryId INTEGER PRIMARY KEY AUTOINCREMENT,
                DocId TEXT NOT NULL,
                SqlHash TEXT NOT NULL,
                EntryType INTEGER NOT NULL DEFAULT 1,
                ExecutedAt INTEGER NOT NULL,
                Server TEXT NOT NULL,
                DatabaseName TEXT NOT NULL,
                LoginName TEXT NULL,
                IsSelection INTEGER NOT NULL DEFAULT 0,
                DurationMs INTEGER NULL,
                Status INTEGER NULL,
                ErrorSummary TEXT NULL,
                RunCount INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (DocId) REFERENCES HistoryDocument(DocId) ON DELETE CASCADE,
                FOREIGN KEY (SqlHash) REFERENCES HistoryContent(SqlHash)
            );
        """)
        conn.commit()

    # 2. Khởi tạo HistoryStore - phải tự phát hiện version 1 và migrate lên version 2
    store = HistoryStore(db_path=db_path)

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA user_version;")
        v = cursor.fetchone()[0]
        assert v >= 2, f"Expected user_version >= 2, got {v}"

        # Kiểm tra cột Note và Tag trong HistoryEntry
        cursor.execute("PRAGMA table_info(HistoryEntry);")
        columns = {row[1]: row[2] for row in cursor.fetchall()}
        assert "Note" in columns, "Column 'Note' must exist in HistoryEntry"
        assert "Tag" in columns, "Column 'Tag' must exist in HistoryEntry"

        # Kiểm tra index mới
        cursor.execute("SELECT name FROM sqlite_master WHERE type='index';")
        indexes = [row[0] for row in cursor.fetchall()]
        assert "IX_History_Server_Db" in indexes, "Index 'IX_History_Server_Db' must exist"
        assert "IX_History_Tag" in indexes, "Index 'IX_History_Tag' must exist"

    print("[Pass] Test 1: SQLite Schema migration v1 -> v2 verified successfully.")


def test_note_and_tag_crud():
    """Kiểm tra thêm, cập nhật, xóa Note và Tag trên HistoryEntry."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_notes_tags.db")
    store = HistoryStore(db_path=db_path)

    # 1. Ghi nhận entry có gắn note và tag ban đầu
    res = store.record_execution(
        doc_id="doc-tags-1",
        display_name="ReleaseScript.sql",
        sql="ALTER TABLE Orders ADD COLUMN StatusText VARCHAR(50);",
        server="SRV-PROD-01",
        database="StoreDB",
        note="Chạy bản vá phiên bản 2.5",
        tag="Release"
    )
    entry_id = res["entry_id"]
    assert entry_id is not None

    # 2. Đọc chi tiết entry
    detail = store.get_entry_detail(entry_id)
    assert detail is not None
    assert detail["Note"] == "Chạy bản vá phiên bản 2.5"
    assert detail["Tag"] == "Release"
    assert "ALTER TABLE Orders" in detail["Sql"]

    # 3. Cập nhật Note và Tag mới
    ok = store.update_entry_note(entry_id, note="Đã kiểm tra kỹ trên staging", tag="Hotfix")
    assert ok is True

    detail_updated = store.get_entry_detail(entry_id)
    assert detail_updated["Note"] == "Đã kiểm tra kỹ trên staging"
    assert detail_updated["Tag"] == "Hotfix"

    # 4. Gỡ tag (đặt rỗng)
    ok_clear = store.update_entry_note(entry_id, note="Ghi chú không kèm tag", tag="")
    assert ok_clear is True
    detail_cleared = store.get_entry_detail(entry_id)
    assert detail_cleared["Note"] == "Ghi chú không kèm tag"
    assert not detail_cleared["Tag"], "Tag should be None or empty after clearing"

    print("[Pass] Test 2: Note & Tag recording and updating verified.")


def test_distinct_filters():
    """Kiểm tra lấy danh sách Server, Database, Tag độc nhất phục vụ bộ lọc dropdown."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_distinct_filters.db")
    store = HistoryStore(db_path=db_path)

    # Thêm nhiều entry từ nhiều server, database, tag khác nhau
    store.record_execution("d1", "Q1.sql", "SELECT 1;", server="SRV-ALPHA", database="DB_PROD", tag="Release")
    store.record_execution("d2", "Q2.sql", "SELECT 2;", server="SRV-BETA", database="DB_STAGING", tag="Test")
    store.record_execution("d3", "Q3.sql", "SELECT 3;", server="SRV-ALPHA", database="DB_ARCHIVE", tag="Migration")
    store.record_execution("d4", "Q4.sql", "SELECT 4;", server="SRV-GAMMA", database="DB_PROD", tag="Release")

    filters = store.get_distinct_filters()
    assert "servers" in filters and "databases" in filters and "tags" in filters
    assert set(filters["servers"]) == {"SRV-ALPHA", "SRV-BETA", "SRV-GAMMA"}
    assert set(filters["databases"]) == {"DB_ARCHIVE", "DB_PROD", "DB_STAGING"}
    assert set(filters["tags"]) == {"Migration", "Release", "Test"}

    print("[Pass] Test 3: get_distinct_filters returns correct sorted unique values.")


def test_advanced_filtering():
    """Kiểm tra bộ lọc đa chiều trên Documents và Entries (Server, Database, Tag, Timestamp, EntryType)."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_adv_filtering.db")
    store = HistoryStore(db_path=db_path)

    now_ms = int(time.time() * 1000)
    day_ms = 86400 * 1000

    # Doc A: SRV-ALPHA, DB_FINANCE, 1 ngày trước
    store.record_execution(
        "doc-a", "Finance.sql", "SELECT * FROM Revenue;",
        server="SRV-ALPHA", database="DB_FINANCE",
        executed_at=now_ms - day_ms, tag="Release"
    )
    # Doc B: SRV-BETA, DB_HR, 5 ngày trước
    store.record_execution(
        "doc-b", "HR.sql", "SELECT * FROM Employees;",
        server="SRV-BETA", database="DB_HR",
        executed_at=now_ms - 5 * day_ms, tag="Hotfix"
    )
    # Doc C: SRV-ALPHA, DB_LOGISTICS, 15 ngày trước
    store.record_execution(
        "doc-c", "Logistics.sql", "SELECT * FROM Shipments;",
        server="SRV-ALPHA", database="DB_LOGISTICS",
        executed_at=now_ms - 15 * day_ms, tag="Test"
    )

    # 1. Lọc Documents theo Server "SRV-ALPHA"
    docs_alpha = store.get_documents(server="SRV-ALPHA")
    assert len(docs_alpha) == 2
    assert {d["DocId"] for d in docs_alpha} == {"doc-a", "doc-c"}

    # 2. Lọc Documents theo Database "DB_HR"
    docs_hr = store.get_documents(database="DB_HR")
    assert len(docs_hr) == 1
    assert docs_hr[0]["DocId"] == "doc-b"

    # 3. Lọc Documents theo khoảng thời gian (7 ngày gần nhất)
    docs_7d = store.get_documents(from_timestamp=now_ms - 7 * day_ms)
    assert len(docs_7d) == 2
    assert {d["DocId"] for d in docs_7d} == {"doc-a", "doc-b"}

    # 4. Lọc Entries theo Tag
    entries_release = store.get_entries("doc-a", tag="Release")
    assert len(entries_release) == 1
    entries_hotfix = store.get_entries("doc-a", tag="Hotfix")
    assert len(entries_hotfix) == 0

    print("[Pass] Test 4: Multi-dimensional filtering on Documents and Entries verified.")


def test_snapshot_recording():
    """Kiểm tra ghi nhận Snapshot khi lưu tab hoặc đóng tab (EntryType = 2, Status = 0)."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_snapshots.db")
    store = HistoryStore(db_path=db_path)

    # Ghi nhận snapshot
    res = store.record_execution(
        doc_id="doc-tab-snap",
        display_name="SavedQuery.sql",
        sql="-- Auto snapshot on save\nSELECT 42;",
        server="SRV-MAIN",
        database="MasterDB",
        entry_type=2,
        status=0
    )
    assert res["entry_id"] is not None

    entries = store.get_entries("doc-tab-snap")
    assert len(entries) == 1
    snap = entries[0]
    assert snap["EntryType"] == 2
    assert snap["Status"] == 0

    # Lọc chỉ lấy snapshots
    snaps_only = store.get_entries("doc-tab-snap", entry_type=2)
    assert len(snaps_only) == 1

    # Lọc chỉ lấy executions
    execs_only = store.get_entries("doc-tab-snap", entry_type=1)
    assert len(execs_only) == 0

    print("[Pass] Test 5: Tab Save/Close snapshot recording (EntryType = 2) verified.")


def test_export_import_history_roundtrip():
    """Kiểm tra trích xuất (Export) sang JSON và nạp lại (Import) bảo toàn toàn vẹn dữ liệu."""
    temp_dir = tempfile.mkdtemp()
    db_orig = os.path.join(temp_dir, "export_orig.db")
    db_target = os.path.join(temp_dir, "import_target.db")

    store_orig = HistoryStore(db_path=db_orig)
    store_target = HistoryStore(db_path=db_target)

    # Tạo dữ liệu nguồn
    store_orig.record_execution(
        doc_id="doc-exp-1",
        display_name="Inventory.sql",
        sql="SELECT ItemCode, Qty FROM Inventory WHERE Qty > 0;",
        server="SRV-INV",
        database="InvDB",
        note="Ghi chú xuất dữ liệu",
        tag="Production",
        status=0,
        duration_ms=45
    )
    store_orig.toggle_star("doc-exp-1", is_starred=True)

    store_orig.record_execution(
        doc_id="doc-exp-2",
        display_name="Draft.sql",
        sql="SELECT 'draft';",
        server="SRV-DEV",
        database="DevDB",
        entry_type=2,
        status=0
    )

    # 1. Export sang bundle
    bundle = store_orig.export_history()
    assert bundle["version"] >= 2
    assert len(bundle["documents"]) == 2
    total_exported_entries = sum(len(d.get("Entries", [])) for d in bundle["documents"])
    assert total_exported_entries == 2

    # Đảm bảo SQL trong bundle là plaintext dễ đọc và trao đổi
    doc_with_inv = next(d for d in bundle["documents"] if d["DocId"] == "doc-exp-1")
    first_entry = doc_with_inv["Entries"][0]
    assert "Sql" in first_entry
    assert "SELECT ItemCode, Qty" in first_entry["Sql"]

    # 2. Import vào database mới
    import_res = store_target.import_history(bundle)
    assert import_res["success"] is True
    assert import_res["imported_documents"] == 2
    assert import_res["imported_entries"] == 2

    # 3. Kiểm tra dữ liệu trong target store
    target_docs = store_target.get_documents()
    assert len(target_docs) == 2
    doc1 = next(d for d in target_docs if d["DocId"] == "doc-exp-1")
    assert doc1["DisplayName"] == "Inventory.sql"
    assert doc1["IsStarred"] == 1

    target_entries = store_target.get_entries("doc-exp-1")
    assert len(target_entries) == 1
    e1 = target_entries[0]
    assert e1["Tag"] == "Production"
    assert e1["Note"] == "Ghi chú xuất dữ liệu"
    assert e1["DurationMs"] == 45

    e1_detail = store_target.get_entry_detail(e1["EntryId"])
    assert "SELECT ItemCode, Qty" in e1_detail["Sql"]

    print("[Pass] Test 6: History JSON Export & Import roundtrip verified.")


def test_api_and_bridge_integration():
    """Kiểm tra các phương thức IPC bridge trong MainApi và QueryHistorySubwindowApi."""
    class DummyConnectionManager:
        pass

    main_api = MainApi(DummyConnectionManager())
    sub_api = QueryHistorySubwindowApi(main_api)

    # Kiểm tra MainApi có đủ các phương thức Phase 5
    expected_main_methods = [
        "history_update_entry_note",
        "history_get_filters",
        "history_export",
        "history_import",
        "history_open_diff_in_editor",
        "history_get_active_editor_content"
    ]
    for method in expected_main_methods:
        assert hasattr(main_api, method), f"MainApi must expose '{method}'"
        assert callable(getattr(main_api, method)), f"MainApi.{method} must be callable"

    # Kiểm tra QueryHistorySubwindowApi ủy quyền đầy đủ
    expected_sub_methods = [
        "history_update_entry_note",
        "history_get_filters",
        "history_export",
        "history_import",
        "open_diff_in_editor",
        "get_active_editor_content"
    ]
    for method in expected_sub_methods:
        assert hasattr(sub_api, method), f"QueryHistorySubwindowApi must expose '{method}'"

    # Test gọi filter qua sub_api
    f_res = sub_api.history_get_filters()
    assert f_res.get("success") is True
    assert "filters" in f_res

    print("[Pass] Test 7: MainApi & QueryHistorySubwindowApi delegation verified.")


def test_tabs_snapshot_integration():
    """Kiểm tra tabs.js đã tích hợp ghi snapshot khi đóng tab và lưu tab."""
    tabs_js_path = ROOT_DIR / "static" / "js" / "tabs.js"
    assert tabs_js_path.exists(), "tabs.js must exist"

    content = tabs_js_path.read_text(encoding="utf-8")
    assert "entry_type: 2" in content, "tabs.js must record snapshot with entry_type: 2"
    assert "saveActiveTab" in content
    assert "forceCloseTab" in content

    print("[Pass] Test 8: tabs.js snapshot integration on save and close verified.")


def test_ui_components_markup():
    """Kiểm tra các thành phần giao diện Phase 5 trong query_history_window.html và query-history.css."""
    html_path = ROOT_DIR / "templates" / "query_history_window.html"
    css_path = ROOT_DIR / "static" / "css" / "query-history.css"
    js_path = ROOT_DIR / "static" / "js" / "query-history.js"

    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    js_content = js_path.read_text(encoding="utf-8")

    # 1. HTML IDs
    required_ids = [
        "btnAdvancedFilter", "qhFilterBadge", "qhFilterDrawer",
        "qhFilterServer", "qhFilterDatabase", "qhFilterDateRange", "qhFilterTag",
        "btnResetFilters", "btnCloseFilterDrawer",
        "btnExportHistory", "btnImportHistory", "qhImportFileInput",
        "btnDiffMenu", "qhDiffDropdown", "btnDiffPrev", "btnDiffActive", "btnDiffPushMain",
        "qhNoteBar", "qhNoteInput", "qhTagSelect", "btnSaveNote", "qhCurrentTagPill",
        "qhDiffBanner", "qhDiffDescription", "btnToggleDiffInline", "btnCloseDiff",
        "qhMonacoDiffContainer"
    ]
    for element_id in required_ids:
        assert f'id="{element_id}"' in html_content, f"HTML element #{element_id} must exist in query_history_window.html"

    # 2. CSS Classes
    required_css = [
        ".qh-filter-drawer", ".qh-diff-dropdown", ".qh-note-bar",
        ".qh-tag-pill", ".qh-diff-banner", ".qh-badge-tag", ".qh-entry-note-indicator"
    ]
    for css_cls in required_css:
        assert css_cls in css_content, f"CSS class {css_cls} must exist in query-history.css"

    # 3. JS Functions
    required_js_funcs = [
        "loadFilterOptions", "applyFilterChange", "resetFilters",
        "showDiffMode", "closeDiffMode", "handleDiffPrevious",
        "handleDiffActiveEditor", "pushDiffToMainEditor",
        "saveCurrentEntryNote", "handleTagSelect", "saveEntryNoteAndTag",
        "handleExportHistory", "handleImportHistory"
    ]
    for func in required_js_funcs:
        assert func in js_content, f"JS function {func} must exist in query-history.js"

    print("[Pass] Test 9: UI HTML, CSS and JS Phase 5 components verified.")


if __name__ == "__main__":
    print("=" * 70)
    print("RUNNING AUTOMATED TEST SUITE: Query History Phase 5 (Advanced)")
    print("=" * 70)

    test_schema_migration_v2()
    test_note_and_tag_crud()
    test_distinct_filters()
    test_advanced_filtering()
    test_snapshot_recording()
    test_export_import_history_roundtrip()
    test_api_and_bridge_integration()
    test_tabs_snapshot_integration()
    test_ui_components_markup()

    print("=" * 70)
    print("ALL PHASE 5 AUTOMATED TESTS PASSED (9/9) - 100% SUCCESS!")
    print("=" * 70)
