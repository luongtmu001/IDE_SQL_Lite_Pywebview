"""
Unit & Integration Tests for Query History Phase 3 (UI Controller & Real Store Bridge)
Kiểm thử toàn diện:
- QueryHistorySubwindowApi (Ủy quyền đầy đủ các phương thức sang MainApi)
- MainApi.history_open_in_editor & history_open_containing_folder
- Quy trình tra cứu Document, Entry detail, Lazy uncompressed SQL loading
- Xóa Document, xóa Entry, toggle star
- Thống kê dung lượng lưu trữ (Storage stats)
"""

import os
import sys
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.history.storage import HistoryStore
from app.services.history.service import HistoryService
import app.services.history as history_module
from main import MainApi, QueryHistorySubwindowApi


class DummyMainWindow:
    """Mock main window cho pywebview để bắt evaluate_js và focus."""
    def __init__(self):
        self.evaluated_scripts = []
        self.is_focused = False

    def evaluate_js(self, script):
        self.evaluated_scripts.append(script)
        return True

    def focus(self):
        self.is_focused = True


def run_phase3_tests():
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_phase3_history.db")

    # Reset singleton và trỏ tới db tạm
    history_module._history_service = None
    HistoryService._instance = None
    service = HistoryService(db_path=db_path)
    HistoryService._instance = service

    dummy_win = DummyMainWindow()
    main_api = MainApi.__new__(MainApi)
    main_api._window = dummy_win
    main_api._history_window = None

    sub_api = QueryHistorySubwindowApi(main_api)

    try:
        # ── Test 1: Ghi nhận 2 Documents và các Entries ─────────────────────
        rec1 = main_api.history_log_execution({
            "doc_id": "doc-p3-a",
            "display_name": "SalesSummary.sql",
            "file_path": "D:/Projects/SalesSummary.sql",
            "sql": "SELECT Year, SUM(Amount) FROM Sales GROUP BY Year;",
            "server": "PROD-SRV",
            "database": "SalesDB",
            "duration_ms": 55,
            "status": 0
        })
        assert rec1["success"] is True
        entry_id_1 = rec1["entry_id"]

        rec2 = main_api.history_log_execution({
            "doc_id": "doc-p3-b",
            "display_name": "DraftQuery.sql",
            "sql": "SELECT * FROM NonExistentTable;",
            "server": "DEV-SRV",
            "database": "TestDB",
            "duration_ms": 12,
            "status": 1,
            "error_summary": "Msg 208: Invalid object name 'NonExistentTable'."
        })
        assert rec2["success"] is True
        entry_id_2 = rec2["entry_id"]

        print("[Pass] Test 1: Created documents and entries successfully.")

        # ── Test 2: Subwindow API Delegation (QueryHistorySubwindowApi) ──────
        docs_res = sub_api.history_get_documents()
        assert docs_res["success"] is True
        docs = docs_res["documents"]
        assert len(docs) == 2
        doc_names = [d["DisplayName"] for d in docs]
        assert "SalesSummary.sql" in doc_names
        assert "DraftQuery.sql" in doc_names

        # Kiểm tra lọc search
        search_res = sub_api.history_get_documents(search="Sales")
        assert len(search_res["documents"]) == 1
        assert search_res["documents"][0]["DocId"] == "doc-p3-a"

        # Lấy danh sách entries của doc-p3-b
        entries_res = sub_api.history_get_entries("doc-p3-b")
        assert entries_res["success"] is True
        assert len(entries_res["entries"]) == 1
        assert entries_res["entries"][0]["Status"] == 1
        assert "Invalid object name" in entries_res["entries"][0]["ErrorSummary"]

        # Lấy chi tiết SQL giải nén qua entry detail
        detail_res = sub_api.history_get_entry_detail(entry_id_2)
        assert detail_res["success"] is True
        assert "SELECT * FROM NonExistentTable;" in detail_res["entry"]["Sql"]
        print("[Pass] Test 2: Subwindow API delegation and query retrieval verified.")

        # ── Test 3: Star Toggle & Favorites Filter ───────────────────────────
        star_res = sub_api.history_toggle_star("doc-p3-a", is_starred=True)
        assert star_res["success"] is True
        assert star_res["is_starred"] is True

        fav_res = sub_api.history_get_documents(favorites_only=True)
        assert len(fav_res["documents"]) == 1
        assert fav_res["documents"][0]["DocId"] == "doc-p3-a"
        print("[Pass] Test 3: Star toggle and favorites filter verified.")

        # ── Test 4: Open in Editor Integration (open_in_editor) ─────────────
        open_res = sub_api.open_in_editor({
            "sql": "SELECT TOP 10 * FROM dbo.Customer;",
            "title": "CustomerQuery.sql",
            "server": "PROD-SRV",
            "database": "SalesDB"
        })
        assert open_res["success"] is True
        assert len(dummy_win.evaluated_scripts) == 1
        assert "window.openHistoryQueryInNewTab" in dummy_win.evaluated_scripts[0]
        assert "CustomerQuery.sql" in dummy_win.evaluated_scripts[0]
        assert dummy_win.is_focused is True
        print("[Pass] Test 4: Open in editor IPC integration verified.")

        # ── Test 5: Storage Stats & Safe Deletion ────────────────────────────
        stats_res = sub_api.history_get_stats()
        assert stats_res["success"] is True
        stats = stats_res["stats"]
        assert stats["total_documents"] == 2
        assert stats["total_entries"] == 2
        assert stats["unique_contents"] == 2

        # Xóa entry của doc-p3-b
        del_ent = sub_api.history_delete_entry(entry_id_2)
        assert del_ent["success"] is True
        assert len(sub_api.history_get_entries("doc-p3-b")["entries"]) == 0

        # Xóa document doc-p3-a
        del_doc = sub_api.history_delete_document("doc-p3-a")
        assert del_doc["success"] is True
        assert sub_api.history_get_document("doc-p3-a")["success"] is False
        print("[Pass] Test 5: Storage stats and cascading deletion verified.")

        print("\n=======================================================")
        print("ALL PHASE 3 SUBWINDOW & UI BRIDGE TESTS PASSED!")
        print("=======================================================")

    finally:
        service.close(timeout=1.0)
        history_module._history_service = None
        HistoryService._instance = None
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    run_phase3_tests()
