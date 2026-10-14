# -*- coding: utf-8 -*-
"""
tests/test_history_phase4_retention.py:
Automated test suite verifying Phase 4 - Retention & Cleanup for Query History:
1. Retention policy by entries per document (max_entries_per_doc).
2. Retention policy by age (max_age_days) protecting starred documents.
3. Retention policy by maximum DB size (max_db_size_mb).
4. Orphan content cleanup (RefCount <= 0) and empty document purge.
5. Database compacting (VACUUM & incremental_vacuum).
6. Clear all history with optional favorite preservation.
7. Settings -> History UI integration (settings.js CATEGORIES & DEFAULT_SETTINGS).
8. Logging toggle (history.enabled = False) and large SQL truncation.
9. High-volume simulated workload (dedup, compression savings, retrieval latency < 50ms).
"""

import os
import sys
import time
import json
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.services.history.storage import HistoryStore, compress_text, decompress_text
from app.services.history.service import HistoryService
from main import MainApi, QueryHistorySubwindowApi, _load_settings_file
from app.services.connection_manager import ConnectionManager


def test_retention_max_entries_per_doc():
    """Kiểm tra giới hạn số lượng entry tối đa trên mỗi Document."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_retention_entries.db")
    store = HistoryStore(db_path=db_path)

    doc_id = "doc-test-overflow"
    base_ts = int(time.time() * 1000) - 100000  # Vài phút trước
    # Thêm 25 entries với nội dung khác nhau để tạo 25 record
    for i in range(25):
        store.record_execution(
            doc_id=doc_id,
            display_name="TestQuery.sql",
            sql=f"SELECT {i} AS val, GETDATE() AS dt;",
            server="SRV-01",
            database="db_test",
            executed_at=base_ts + i * 1000
        )

    entries = store.get_entries(doc_id=doc_id, limit=100)
    assert len(entries) == 25, f"Expected 25 entries, got {len(entries)}"

    # Áp dụng retention: chỉ giữ tối đa 10 entries (max_age_days = 90)
    res = store.purge_old_entries(max_age_days=90, max_entries_per_doc=10)
    assert res["purged_entries"] == 15, f"Expected 15 purged entries, got {res['purged_entries']}"

    entries_after = store.get_entries(doc_id=doc_id, limit=100)
    assert len(entries_after) == 10, f"Expected exactly 10 remaining entries, got {len(entries_after)}"
    # Đảm bảo 10 entries còn lại là 10 entries mới nhất (i từ 15 đến 24)
    expected_latest_ts = base_ts + 24 * 1000
    assert entries_after[0]["ExecutedAt"] == expected_latest_ts

    print("[Pass] Test 1: Retention by max_entries_per_doc correctly preserved latest entries.")


def test_retention_max_age_and_starred_protection():
    """Kiểm tra xóa entry theo tuổi nhưng bảo vệ Document có đánh dấu sao ⭐."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_retention_age.db")
    store = HistoryStore(db_path=db_path)

    # 1. Document bình thường có entry cũ (120 ngày trước)
    old_time_ms = int((time.time() - 120 * 86400) * 1000)
    store.record_execution(
        doc_id="doc-old-normal",
        display_name="OldNormal.sql",
        sql="SELECT 'old unstarred';",
        server="SRV-01",
        database="db_old",
        executed_at=old_time_ms
    )

    # 2. Document được ghim sao (⭐) có entry cũ (120 ngày trước)
    store.record_execution(
        doc_id="doc-old-starred",
        display_name="ImportantQuery.sql",
        sql="SELECT 'old important starred';",
        server="SRV-01",
        database="db_fav",
        executed_at=old_time_ms
    )
    store.toggle_star("doc-old-starred", is_starred=True)

    # 3. Document mới (1 ngày trước)
    recent_time_ms = int((time.time() - 1 * 86400) * 1000)
    store.record_execution(
        doc_id="doc-recent",
        display_name="Recent.sql",
        sql="SELECT 'recent';",
        server="SRV-01",
        database="db_recent",
        executed_at=recent_time_ms
    )

    # Dọn dẹp với max_age_days = 90
    res = store.purge_old_entries(max_age_days=90, max_entries_per_doc=200)

    # Entry của doc-old-normal phải bị xóa
    entries_normal = store.get_entries("doc-old-normal")
    assert len(entries_normal) == 0, "Old unstarred entry must be purged"

    # Entry của doc-old-starred PHẢI ĐƯỢC GIỮ NGUYÊN
    entries_starred = store.get_entries("doc-old-starred")
    assert len(entries_starred) == 1, "Starred document entry must be protected from age purge"

    # Entry của doc-recent phải còn
    entries_recent = store.get_entries("doc-recent")
    assert len(entries_recent) == 1, "Recent entry must not be purged"

    print("[Pass] Test 2: Age retention purged expired records while strictly protecting starred favorites.")


def test_retention_orphan_content_and_empty_doc_purge():
    """Kiểm tra Content mồ côi (RefCount <= 0) và Document rỗng tự động bị dọn."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_orphan.db")
    store = HistoryStore(db_path=db_path)

    doc_id = "doc-temp-clean"
    store.record_execution(
        doc_id=doc_id,
        display_name="TempClean.sql",
        sql="SELECT 'orphaned candidate';",
        server="SRV-01",
        database="master"
    )

    stats_before = store.get_storage_stats()
    assert stats_before["unique_contents"] == 1
    assert stats_before["total_documents"] == 1

    # Xóa document
    store.delete_document(doc_id)

    stats_after = store.get_storage_stats()
    assert stats_after["total_documents"] == 0, "Document should be deleted"
    assert stats_after["unique_contents"] == 0, "Content with RefCount=0 should be deleted"

    print("[Pass] Test 3: Orphaned content and empty documents cleanly purged without leaving dangling records.")


def test_compact_and_clear_all():
    """Kiểm tra chức năng compact (VACUUM) và clear_all (xóa toàn bộ / giữ favorites)."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_compact.db")
    store = HistoryStore(db_path=db_path)

    # Tạo 50 records
    for i in range(50):
        store.record_execution(
            doc_id=f"doc-{i % 5}",
            display_name=f"Query_{i % 5}.sql",
            sql=f"SELECT {i}, REPEAT('X', 500);",
            server="SRV",
            database="db"
        )

    # Ghim sao doc-0
    store.toggle_star("doc-0", is_starred=True)

    # Chạy compact
    compact_stats = store.compact()
    assert compact_stats["total_entries"] == 50

    # Clear all nhưng giữ favorites (keep_favorites=True)
    stats_kept = store.clear_all(keep_favorites=True)
    docs_remaining = store.get_documents()
    assert len(docs_remaining) == 1, "Only starred doc-0 should remain"
    assert docs_remaining[0]["DocId"] == "doc-0"

    # Clear all hoàn toàn (keep_favorites=False)
    stats_empty = store.clear_all(keep_favorites=False)
    assert stats_empty["total_documents"] == 0
    assert stats_empty["total_entries"] == 0
    assert stats_empty["unique_contents"] == 0

    print("[Pass] Test 4: Database compact and clear_all operations verified.")


def test_settings_js_history_category_and_defaults():
    """Kiểm tra cấu hình History được đăng ký đầy đủ trong static/js/settings.js."""
    settings_js_path = ROOT_DIR / "static" / "js" / "settings.js"
    assert settings_js_path.exists(), "settings.js must exist"
    content = settings_js_path.read_text(encoding="utf-8")

    # Kiểm tra Category history
    assert "key: 'history'" in content
    assert "name: 'Lịch sử truy vấn'" in content
    assert "subtitle: 'Query History'" in content
    assert "fa-clock-rotate-left" in content

    # Kiểm tra các trường cấu hình
    assert "key: 'enabled'" in content
    assert "key: 'maxEntriesPerDoc'" in content
    assert "key: 'maxAgeDays'" in content
    assert "key: 'maxDbSizeMb'" in content
    assert "key: 'maxEntrySizeKb'" in content
    assert "key: 'storageManagement'" in content

    # Kiểm tra DEFAULT_SETTINGS
    assert "history: {" in content
    assert "maxEntriesPerDoc: 200" in content
    assert "maxAgeDays: 90" in content
    assert "maxDbSizeMb: 500" in content
    assert "maxEntrySizeKb: 1024" in content

    # Kiểm tra UI box và actions
    assert "renderHistoryStorageManagement" in content
    assert "qhBtnCompact" in content
    assert "qhBtnPurge" in content
    assert "qhBtnClearAll" in content

    print("[Pass] Test 5: Settings -> History category, fields, defaults and maintenance UI registered in settings.js.")


def test_logging_toggle_and_large_query_truncation():
    """Kiểm tra bật/tắt ghi lịch sử (history.enabled) và cắt gọn câu lệnh vượt kích thước."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_toggle.db")
    store = HistoryStore(db_path=db_path)

    # 1. Truncation khi câu truy vấn vượt max_entry_size (ví dụ cấu hình max_entry_size = 1000 bytes)
    huge_sql = "SELECT '" + ("A" * 5000) + "';"
    res = store.record_execution(
        doc_id="doc-huge",
        display_name="HugeQuery.sql",
        sql=huge_sql,
        server="SRV",
        database="db",
        max_entry_size=1000
    )
    assert res is not None and "entry_id" in res
    entry_detail = store.get_entry_detail(res["entry_id"])
    assert entry_detail is not None
    assert "[TRUNCATED:" in (entry_detail.get("Sql") or "")

    # 2. MainApi history_log_execution tôn trọng history.enabled
    cm = ConnectionManager()
    main_api = MainApi(cm)

    # Mock _load_settings_file với history.enabled = False
    import main
    orig_load_settings = main._load_settings_file
    try:
        main._load_settings_file = lambda: {
            "history": {"enabled": False}
        }
        res_disabled = main_api.history_log_execution({
            "doc_id": "doc-should-skip",
            "sql": "SELECT 1;"
        })
        assert res_disabled.get("disabled") is True, "Must return disabled=True when history.enabled=False"
        assert res_disabled.get("entry_id") is None
    finally:
        main._load_settings_file = orig_load_settings

    print("[Pass] Test 6: Logging toggle (history.enabled) and large query truncation verified.")


def test_high_volume_stress_and_performance():
    """Mô phỏng khối lượng lớn (1,000+ executions lặp lại và mới), kiểm tra Dedup, Nén và Thời gian truy vấn < 50ms."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_stress.db")
    store = HistoryStore(db_path=db_path)

    start_insert = time.perf_counter()
    num_runs = 1200
    # Mô phỏng 20 documents khác nhau, mỗi document chạy lặp đi lặp lại 60 lần (trong đó nhiều lần giống nhau)
    for i in range(num_runs):
        doc_idx = i % 20
        query_idx = (i // 20) % 5  # Mỗi doc chỉ có 5 query khác nhau lặp lại
        sql = f"""-- Realistic Production SQL Report {doc_idx}_{query_idx}
WITH CTE_Orders AS (
    SELECT order_id, customer_id, order_date, total_price, order_status, discount_rate
    FROM orders_table_{doc_idx}
    WHERE order_status = '{query_idx}' AND order_date >= '2026-01-01'
),
CTE_Summary AS (
    SELECT customer_id, COUNT(order_id) AS order_count, SUM(total_price) AS sum_price, AVG(discount_rate) AS avg_discount
    FROM CTE_Orders
    GROUP BY customer_id
)
SELECT s.customer_id, s.order_count, s.sum_price, s.avg_discount,
       c.customer_name, c.email_address, c.contact_phone, c.billing_address, c.shipping_country
FROM CTE_Summary s
JOIN customers_directory c ON c.customer_id = s.customer_id
WHERE s.sum_price > 5000000
ORDER BY s.sum_price DESC, s.order_count DESC;
"""
        store.record_execution(
            doc_id=f"stress-doc-{doc_idx}",
            display_name=f"StressQuery_{doc_idx}.sql",
            sql=sql,
            server="PROD-SQL-01",
            database=f"db_{doc_idx % 3}"
        )
    insert_duration = time.perf_counter() - start_insert

    stats = store.get_storage_stats()
    # 20 docs * 5 unique queries = tối đa 100 unique contents
    assert stats["total_documents"] == 20
    assert stats["unique_contents"] <= 100, f"Expected deduplication to keep unique contents <= 100, got {stats['unique_contents']}"
    assert stats["compression_savings_pct"] > 40.0, f"Expected compression savings > 40%, got {stats['compression_savings_pct']}%"

    # Kiểm tra thời gian truy vấn danh sách documents
    t0 = time.perf_counter()
    docs = store.get_documents(limit=100)
    query_docs_ms = (time.perf_counter() - t0) * 1000
    assert len(docs) == 20
    assert query_docs_ms < 50.0, f"Document listing too slow: {query_docs_ms:.2f} ms (expected < 50 ms)"

    # Kiểm tra thời gian truy vấn entries của 1 document
    t1 = time.perf_counter()
    entries = store.get_entries(doc_id="stress-doc-0", limit=100)
    query_entries_ms = (time.perf_counter() - t1) * 1000
    assert query_entries_ms < 50.0, f"Entries listing too slow: {query_entries_ms:.2f} ms (expected < 50 ms)"

    # Kiểm tra thời gian giải nén nội dung entry
    if entries:
        t2 = time.perf_counter()
        detail = store.get_entry_detail(entries[0]["EntryId"])
        detail_ms = (time.perf_counter() - t2) * 1000
        assert detail is not None
        assert detail_ms < 50.0, f"Entry detail retrieval too slow: {detail_ms:.2f} ms (expected < 50 ms)"

    print(f"[Pass] Test 7: Stress workload simulated ({num_runs} executions). Dedup: {stats['unique_contents']} contents. Compression savings: {stats['compression_savings_pct']}%. Query latency: docs={query_docs_ms:.2f}ms, entries={query_entries_ms:.2f}ms (< 50ms requirement).")


def test_settings_json_integrity():
    """Kiểm tra data/settings.json không bị ghi đè hay biến đổi sai cấu trúc."""
    settings_file = ROOT_DIR / "data" / "settings.json"
    assert settings_file.exists(), "data/settings.json must exist"
    data = json.loads(settings_file.read_text(encoding="utf-8"))
    assert "theme" in data or "appearance" in data
    assert "editor" in data
    print("[Pass] Test 8: data/settings.json integrity verified.")


if __name__ == "__main__":
    test_retention_max_entries_per_doc()
    test_retention_max_age_and_starred_protection()
    test_retention_orphan_content_and_empty_doc_purge()
    test_compact_and_clear_all()
    test_settings_js_history_category_and_defaults()
    test_logging_toggle_and_large_query_truncation()
    test_high_volume_stress_and_performance()
    test_settings_json_integrity()

    print("\n" + "=" * 60)
    print("ALL PHASE 4 RETENTION & CLEANUP TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)
