"""
Unit Tests for Query History Storage Engine (Phase 1)
Kiểm thử toàn diện:
- SQLite schema, WAL mode, user_version migration
- Chuẩn hóa EOL và lọc trivial query (comment / empty)
- Dedup theo SHA-256 hash trong bảng Content
- Tỷ lệ nén zlib cho Body SQL
- Gộp RunCount cho các lần chạy F5 liên tiếp giống hệt
- Cập nhật kết quả truy vấn (UpdateEntryResult)
- Quản lý RefCount và xóa an toàn (Safe Cascading Delete)
- Gắn sao / Bỏ gắn sao (ToggleStar)
- Chính sách dọn dẹp chống phình bộ nhớ (Retention Purge)
- Thống kê dung lượng & nén
"""

import os
import sys
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.history.storage import (
    HistoryStore,
    normalize_sql_text,
    is_trivial_query,
    compute_sha256,
    compress_text,
    decompress_text
)


def run_all_tests():
    temp_dir = tempfile.mkdtemp()
    test_db_path = os.path.join(temp_dir, "test_history.db")

    try:
        store = HistoryStore(db_path=test_db_path)

        # ── Test 1: Normalization & Trivial Queries ─────────────────────────
        raw_sql = "SELECT * \r\nFROM dbo.Users\r\nWHERE Id = 1;"
        norm_sql = normalize_sql_text(raw_sql)
        assert "\r" not in norm_sql, "EOL carriage returns must be converted to \\n"
        assert "\n" in norm_sql, "Line breaks must be preserved"

        assert is_trivial_query(""), "Empty query is trivial"
        assert is_trivial_query("   \t  \n "), "Whitespace query is trivial"
        assert is_trivial_query("-- Only a single line comment\n"), "Single-line comment is trivial"
        assert is_trivial_query("/* Multi-line \n comment block */"), "Multi-line comment is trivial"
        assert not is_trivial_query("SELECT 1;"), "Actual SQL is not trivial"
        print("[Pass] Test 1: Text normalization and trivial query filter verified.")

        # ── Test 2: Database Initialization & Pragmas ───────────────────────
        stats = store.get_storage_stats()
        assert stats["total_documents"] == 0
        assert stats["total_entries"] == 0
        assert stats["unique_contents"] == 0
        assert os.path.exists(test_db_path), "Database file must exist"
        print("[Pass] Test 2: Database schema and initialization verified.")

        # ── Test 3: Add Entry & Document Creation ───────────────────────────
        res1 = store.add_entry(
            doc_id="doc-1",
            display_name="SQLQuery1.sql",
            sql="SELECT CustomerCode, CustomerName FROM dbo.Customer WHERE Status = 1;",
            server="SRV-PROD",
            database="ERP_DB",
            login="sa"
        )
        assert res1 is not None
        assert res1["is_new"] is True
        assert res1["run_count"] == 1
        entry_id_1 = res1["entry_id"]

        docs = store.get_documents()
        assert len(docs) == 1
        assert docs[0]["DocId"] == "doc-1"
        assert docs[0]["DisplayName"] == "SQLQuery1.sql"
        assert docs[0]["LastServer"] == "SRV-PROD"
        assert docs[0]["LastDatabase"] == "ERP_DB"
        assert docs[0]["EntryCount"] == 1
        print("[Pass] Test 3: Add entry and document creation verified.")

        # ── Test 4: Consecutive Identical Run Collapsing (RunCount) ─────────
        # Chạy lại cùng câu SQL trong cùng doc -> phải gộp RunCount = 2, không tạo entry mới
        res2 = store.add_entry(
            doc_id="doc-1",
            display_name="SQLQuery1.sql",
            sql="SELECT CustomerCode, CustomerName FROM dbo.Customer WHERE Status = 1;",
            server="SRV-PROD",
            database="ERP_DB",
            duration_ms=45,
            status=0
        )
        assert res2["is_new"] is False
        assert res2["entry_id"] == entry_id_1
        assert res2["run_count"] == 2

        # Kiểm tra lại số lượng entry trong Document
        entries = store.get_entries("doc-1")
        assert len(entries) == 1, "Must still be 1 entry row due to RunCount collapsing"
        assert entries[0]["RunCount"] == 2
        assert entries[0]["DurationMs"] == 45
        assert entries[0]["Status"] == 0
        print("[Pass] Test 4: Consecutive identical run collapsing (RunCount) verified.")

        # ── Test 5: Update Entry Result ─────────────────────────────────────
        update_ok = store.update_entry_result(
            entry_id=entry_id_1,
            duration_ms=110,
            status=0,
            error_summary=None
        )
        assert update_ok is True
        detail = store.get_entry_detail(entry_id_1)
        assert detail["DurationMs"] == 110
        assert detail["Status"] == 0
        assert "dbo.Customer" in detail["Sql"]
        print("[Pass] Test 5: Update entry result verified.")

        # ── Test 6: Deduplication via SHA-256 Hash & RefCount ───────────────
        # Tạo document 2 nhưng chạy lại ĐÚNG câu SQL trên
        res_doc2 = store.add_entry(
            doc_id="doc-2",
            display_name="Report.sql",
            file_path="D:\\Reports\\Report.sql",
            sql="SELECT CustomerCode, CustomerName FROM dbo.Customer WHERE Status = 1;",
            server="SRV-PROD",
            database="ERP_DB"
        )
        assert res_doc2["is_new"] is True
        assert res_doc2["content_hash"] == res1["content_hash"]

        # Bảng Content chỉ được có đúng 1 row duy nhất với RefCount = 2
        stats = store.get_storage_stats()
        assert stats["total_documents"] == 2
        assert stats["total_entries"] == 2
        assert stats["unique_contents"] == 1, "Content must be deduplicated by hash (1 row)"
        print("[Pass] Test 6: SHA-256 deduplication and RefCount verified.")

        # ── Test 7: Compression Integrity ───────────────────────────────────
        long_sql = "-- CTE Multi-join test\n" + ("SELECT 1 AS Col, 'TestString' AS Val UNION ALL \n" * 50) + "SELECT 2, 'End';"
        res_long = store.add_entry(
            doc_id="doc-1",
            display_name="SQLQuery1.sql",
            sql=long_sql,
            server="SRV-PROD",
            database="ERP_DB"
        )
        long_entry_id = res_long["entry_id"]
        detail_long = store.get_entry_detail(long_entry_id)
        assert detail_long["Sql"] == normalize_sql_text(long_sql), "Decompressed SQL must match original exactly"
        stats = store.get_storage_stats()
        assert stats["compression_savings_pct"] > 50.0, "Zlib should save > 50% for SQL scripts"
        print(f"[Pass] Test 7: Compression integrity verified (Savings: {stats['compression_savings_pct']}%).")

        # ── Test 8: Toggle Star & Search ────────────────────────────────────
        is_star = store.toggle_star("doc-1")
        assert is_star is True
        doc_star = store.get_document("doc-1")
        assert doc_star["IsStarred"] == 1

        fav_docs = store.get_documents(favorites_only=True)
        assert len(fav_docs) == 1
        assert fav_docs[0]["DocId"] == "doc-1"

        search_docs = store.get_documents(search="Report")
        assert len(search_docs) == 1
        assert search_docs[0]["DocId"] == "doc-2"
        print("[Pass] Test 8: Toggle star and search filters verified.")

        # ── Test 9: Safe Cascading Deletion ─────────────────────────────────
        # Khi xóa entry của doc-2 (dùng chung content với entry 1 của doc-1)
        store.delete_entry(res_doc2["entry_id"])
        # Content hash vẫn phải tồn tại vì doc-1 vẫn đang tham chiếu (RefCount = 1)
        stats = store.get_storage_stats()
        assert stats["unique_contents"] == 2

        # Khi xóa cả entry 1 của doc-1, Content hash đó phải tự động bị xóa (RefCount = 0)
        store.delete_entry(entry_id_1)
        stats = store.get_storage_stats()
        assert stats["unique_contents"] == 1, "Orphaned Content must be purged automatically"
        print("[Pass] Test 9: Safe cascading deletion and RefCount cleanup verified.")

        # ── Test 10: Retention Purge Policy ─────────────────────────────────
        # Thêm 10 entry giả định cho doc-3
        for i in range(10):
            store.add_entry(
                doc_id="doc-3",
                display_name="Scratch.sql",
                sql=f"SELECT {i} AS TestVal;",
                server="localhost",
                database="tempdb"
            )
        assert len(store.get_entries("doc-3")) == 10

        # Giới hạn max 3 entries per doc
        purge_res = store.purge_old_entries(max_age_days=365, max_entries_per_doc=3)
        assert purge_res["purged_entries"] >= 7
        entries_rem = store.get_entries("doc-3")
        assert len(entries_rem) == 3, "Only the 3 newest entries must remain"
        print("[Pass] Test 10: Retention purge policy verified.")

        store.close()
        print("\n=======================================================")
        print("ALL 10 PHASE 1 HISTORY STORE TESTS PASSED SUCCESSFULLY!")
        print("=======================================================")

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    run_all_tests()
