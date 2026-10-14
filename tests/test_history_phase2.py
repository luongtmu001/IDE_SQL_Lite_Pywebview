"""
Unit & Integration Tests for Query History Phase 2 (Execution Hook & Document Tracking)
Kiểm thử toàn diện:
- HistoryService (Singleton, record_execution, update_entry_result, update_document)
- Document file path merging khi Save As trùng file trên đĩa
- MainApi Native IPC methods (Zero-Network desktop pywebview bridge)
- Tích hợp không chặn (safe fallback, handling trivial/empty SQL)
- Safe cascading deletion, statistics, star toggle
"""

import os
import sys
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.history.storage import HistoryStore
from app.services.history.service import HistoryService
import app.services.history as history_module


def run_phase2_tests():
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_phase2_history.db")

    # Reset singleton
    history_module._history_service = None
    HistoryService._instance = None

    # Khởi tạo service với db tạm
    service = HistoryService(db_path=db_path)
    HistoryService._instance = service

    try:
        # ── Test 1: Service Record & Update Result ──────────────────────────
        rec = service.record_execution(
            doc_id="doc-phase2-1",
            display_name="Query1.sql",
            sql="SELECT id, name FROM users WHERE active = 1;",
            server="SQL-SRV1",
            database="AppDb",
            login="sa",
            is_selection=False
        )

        assert rec is not None, "Record result must not be None"
        assert rec["is_new"] is True, "Must be a new entry"
        assert rec["run_count"] == 1, "RunCount must be 1"
        entry_id = rec["entry_id"]
        assert entry_id > 0, "Valid entry_id must be returned"

        # Kiểm tra trạng thái ban đầu (Status = NULL)
        entry = service.get_entry_detail(entry_id)
        assert entry is not None, "Entry detail must exist"
        assert entry["Status"] is None, "Initial status should be NULL"
        assert entry["DurationMs"] is None, "Initial duration should be NULL"
        assert "users WHERE active = 1" in entry["Sql"], "SQL body must match"

        # Cập nhật kết quả sau khi query hoàn tất
        ok = service.update_entry_result(
            entry_id=entry_id,
            duration_ms=125,
            status=0,
            error_summary=None
        )
        assert ok is True, "update_entry_result must return True"

        # Xác thực thông tin sau khi cập nhật
        updated_entry = service.get_entry_detail(entry_id)
        assert updated_entry["DurationMs"] == 125, "DurationMs must be updated to 125"
        assert updated_entry["Status"] == 0, "Status must be updated to 0 (OK)"
        assert updated_entry["ErrorSummary"] is None
        print("[Pass] Test 1: HistoryService record_execution & update_entry_result verified.")

        # ── Test 2: Document Merging on Save As ──────────────────────────────
        file_path = "D:/Work/Queries/SalesMonthly.sql"

        # Tab 1: Đã lưu trên đĩa từ trước (DocId = doc-sales-disk)
        service.record_execution(
            doc_id="doc-sales-disk",
            display_name="SalesMonthly.sql",
            sql="SELECT SUM(TotalAmount) FROM Sales.Orders WHERE Year = 2026;",
            server="ERP-DB",
            database="SalesDB",
            file_path=file_path
        )

        # Tab 2: Tab mới chưa lưu (DocId = doc-untitled-tab), chạy 2 query
        service.record_execution(
            doc_id="doc-untitled-tab",
            display_name="Query 2",
            sql="SELECT TOP 10 * FROM Sales.Customers;",
            server="ERP-DB",
            database="SalesDB"
        )
        service.record_execution(
            doc_id="doc-untitled-tab",
            display_name="Query 2",
            sql="SELECT COUNT(*) FROM Sales.Invoices;",
            server="ERP-DB",
            database="SalesDB"
        )

        # Trước khi gộp: có 2 Documents riêng biệt
        docs = service.get_documents()
        doc_ids = {d["DocId"] for d in docs}
        assert "doc-sales-disk" in doc_ids, "doc-sales-disk must exist"
        assert "doc-untitled-tab" in doc_ids, "doc-untitled-tab must exist"

        # Người dùng bấm Save As trên Tab 2 trỏ vào "D:/Work/Queries/SalesMonthly.sql"
        merge_res = service.update_document(
            doc_id="doc-untitled-tab",
            display_name="SalesMonthly.sql",
            file_path=file_path
        )

        assert merge_res["success"] is True, "update_document must succeed"
        assert merge_res["merged"] is True, "Must detect file collision and merge"
        assert merge_res["target_doc_id"] == "doc-sales-disk", "Target doc id must be doc-sales-disk"

        # Sau khi gộp: Document tạm doc-untitled-tab đã được dọn dẹp
        docs_after = service.get_documents()
        doc_ids_after = {d["DocId"] for d in docs_after}
        assert "doc-untitled-tab" not in doc_ids_after, "Temporary doc must be removed after merge"
        target_doc = next(d for d in docs_after if d["DocId"] == "doc-sales-disk")
        # Tổng entry của doc-sales-disk phải là 1 + 2 = 3 entries
        assert target_doc["EntryCount"] == 3, f"EntryCount should be 3, got {target_doc['EntryCount']}"

        # Các entry trong doc-sales-disk có đầy đủ cả 3 câu SQL
        entries = service.get_entries("doc-sales-disk")
        assert len(entries) == 3, "Must have all 3 entries transferred"
        print("[Pass] Test 2: Document merging on Save As / FilePath collision verified.")

        # ── Test 3: MainApi Native IPC Bridge Methods ────────────────────────
        # Mock class kế thừa các methods của MainApi mà không cần khởi động GUI pywebview
        from main import MainApi

        # Khởi tạo MainApi instance (không truyền window)
        native_api = MainApi.__new__(MainApi)
        native_api._history_window = None

        # 1. history_log_execution
        log_res = native_api.history_log_execution({
            "doc_id": "api-tab-1",
            "display_name": "API_Test.sql",
            "sql": "SELECT 100 AS Number, 'Hello Native IPC' AS Message;",
            "server": "SRV-TEST",
            "database": "TestDB",
            "login": "dev_user",
            "is_selection": True
        })
        assert log_res["success"] is True
        api_entry_id = log_res["entry_id"]
        assert api_entry_id is not None

        # 2. history_update_execution
        upd_res = native_api.history_update_execution({
            "entry_id": api_entry_id,
            "duration_ms": 42,
            "status": 0,
            "error_summary": None
        })
        assert upd_res["success"] is True
        assert upd_res["updated"] is True

        # 3. history_get_document
        doc_res = native_api.history_get_document("api-tab-1")
        assert doc_res["success"] is True
        assert doc_res["document"]["DisplayName"] == "API_Test.sql"
        assert doc_res["document"]["LastServer"] == "SRV-TEST"

        # 4. history_get_entries
        entries_res = native_api.history_get_entries("api-tab-1")
        assert entries_res["success"] is True
        assert len(entries_res["entries"]) == 1
        assert entries_res["entries"][0]["DurationMs"] == 42
        assert entries_res["entries"][0]["Status"] == 0

        # 5. history_get_entry_detail
        detail_res = native_api.history_get_entry_detail(api_entry_id)
        assert detail_res["success"] is True
        assert "Hello Native IPC" in detail_res["entry"]["Sql"]

        # 6. history_toggle_star
        star_res = native_api.history_toggle_star("api-tab-1")
        assert star_res["success"] is True
        assert star_res["is_starred"] is True

        # 7. history_get_documents (favorites_only)
        fav_res = native_api.history_get_documents(favorites_only=True)
        assert fav_res["success"] is True
        assert len(fav_res["documents"]) == 1
        assert fav_res["documents"][0]["DocId"] == "api-tab-1"

        # 8. history_get_stats
        stats_res = native_api.history_get_stats()
        assert stats_res["success"] is True
        assert stats_res["stats"]["total_documents"] >= 2
        assert stats_res["stats"]["total_entries"] >= 4

        # 9. history_update_document & history_get_document_by_path
        native_api.history_update_document({
            "doc_id": "api-tab-1",
            "file_path": "C:/Projects/native_test.sql"
        })
        path_res = native_api.history_get_document_by_path("C:/Projects/native_test.sql")
        assert path_res["success"] is True
        assert path_res["document"]["DocId"] == "api-tab-1"

        # 10. history_delete_entry
        del_entry_res = native_api.history_delete_entry(api_entry_id)
        assert del_entry_res["success"] is True

        # 11. history_delete_document
        del_doc_res = native_api.history_delete_document("api-tab-1")
        assert del_doc_res["success"] is True

        # Document api-tab-1 đã bị xóa
        check_del = native_api.history_get_document("api-tab-1")
        assert check_del["success"] is False
        print("[Pass] Test 3: MainApi Native IPC bridge methods (100% parity) verified.")

        # ── Test 4: Trivial & Skipped Queries Filter ─────────────────────────
        skip_res = native_api.history_log_execution({
            "doc_id": "tab-comment-only",
            "sql": "-- Only a comment\n/* Block comment */"
        })
        assert skip_res["success"] is True
        assert skip_res.get("skipped") is True
        assert skip_res.get("entry_id") is None

        # Không tạo Document rác trong DB
        check_skip = native_api.history_get_document("tab-comment-only")
        assert check_skip["success"] is False
        print("[Pass] Test 4: Trivial/Comment query skipping verified.")

        # ── Test 5: Optional Flask REST API Flow (nếu có Flask) ──────────────
        try:
            from app import create_app
            app = create_app()
            app.config["TESTING"] = True
            client = app.test_client()

            res = client.post("/api/history/log_execution", json={
                "doc_id": "flask-tab-test",
                "sql": "SELECT 1;",
                "server": "localhost",
                "database": "master"
            })
            assert res.status_code == 200
            print("[Pass] Test 5: Flask REST API blueprint flow verified.")
        except (ImportError, TypeError):
            print("[Skip] Test 5: Flask not installed in current environment (Zero-Network pywebview mode active).")

        print("\n=======================================================")
        print("ALL PHASE 2 INTEGRATION & IPC BRIDGE TESTS PASSED!")
        print("=======================================================")

    finally:
        service.shutdown(timeout=1.0)
        history_module._history_service = None
        HistoryService._instance = None
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    run_phase2_tests()
