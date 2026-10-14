"""
History Service & Background Writer (Phase 2) — luoBTool IDE

Quản lý luồng ghi nhật ký truy vấn bất đồng bộ (Background Writer),
cung cấp API cho Flask routes và pywebview native IPC bridge:
- Đảm bảo F5 không bị chậm (< 5ms UI latency)
- Flush hàng đợi an toàn khi thoát ứng dụng (timeout ~2s)
- Lên lịch tự động dọn dẹp theo chính sách Retention sau 30s khởi động
"""

import os
import time
import queue
import logging
import threading
from typing import Optional, Dict, Any, List

from app.services.history.storage import HistoryStore

logger = logging.getLogger("HistoryService")


class HistoryService:
    """Singleton service điều phối HistoryStore và hàng đợi background worker."""

    _instance: Optional["HistoryService"] = None
    _init_lock = threading.Lock()

    def __init__(self, db_path: Optional[str] = None):
        self.store = HistoryStore(db_path=db_path)
        self._queue: queue.Queue = queue.Queue(maxsize=10000)
        self._stop_event = threading.Event()
        self._worker_thread = threading.Thread(
            target=self._worker_loop,
            daemon=True,
            name="HistoryBackgroundWriter"
        )
        self._worker_thread.start()

        self._write_count = 0

        # Khởi động timer dọn dẹp nền sau 30s
        self._retention_timer = threading.Timer(30.0, self._run_background_retention)
        self._retention_timer.daemon = True
        self._retention_timer.start()

    @classmethod
    def get_instance(cls, db_path: Optional[str] = None) -> "HistoryService":
        with cls._init_lock:
            if cls._instance is None:
                cls._instance = cls(db_path=db_path)
            return cls._instance

    def _worker_loop(self):
        """Vòng lặp tiêu thụ hàng đợi ngầm."""
        while not self._stop_event.is_set():
            try:
                task = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue

            try:
                task_type, payload = task
                if task_type == "RECORD":
                    self.store.record_execution(**payload)
                elif task_type == "UPDATE_RESULT":
                    self.store.update_entry_result(**payload)
                elif task_type == "UPDATE_DOC":
                    self.store.update_document(**payload)
                elif task_type == "PURGE":
                    self.store.purge_old_entries(**payload)
            except Exception as exc:
                logger.error("[HistoryService] Background task %s error: %s", task_type, exc)
            finally:
                self._queue.task_done()

    def _run_background_retention(self):
        """Chạy dọn dẹp ngầm theo retention policy và lên lịch định kỳ."""
        try:
            max_age_days = 90
            max_entries_per_doc = 200
            max_db_size_mb = 500
            try:
                from main import _load_settings_file
                st = _load_settings_file()
                h_cfg = st.get("history", {})
                max_age_days = int(h_cfg.get("maxAgeDays", 90))
                max_entries_per_doc = int(h_cfg.get("maxEntriesPerDoc", 200))
                max_db_size_mb = int(h_cfg.get("maxDbSizeMb", 500))
            except Exception:
                pass

            res = self.store.purge_old_entries(
                max_age_days=max_age_days,
                max_entries_per_doc=max_entries_per_doc,
                max_db_size_mb=max_db_size_mb
            )
            logger.info("[HistoryService] Background retention completed: %s", res)
        except Exception as exc:
            logger.warning("[HistoryService] Background retention failed: %s", exc)
        finally:
            # Lên lịch định kỳ mỗi 6 tiếng nếu service vẫn đang hoạt động
            if not self._stop_event.is_set():
                try:
                    self._retention_timer = threading.Timer(21600.0, self._run_background_retention)
                    self._retention_timer.daemon = True
                    self._retention_timer.start()
                except Exception:
                    pass

    def record_execution(
        self,
        doc_id: str,
        display_name: str,
        sql: str,
        server: str,
        database: str,
        file_path: Optional[str] = None,
        login: Optional[str] = None,
        is_selection: bool = False,
        entry_type: int = 1,
        executed_at: Optional[int] = None,
        duration_ms: Optional[int] = None,
        status: Optional[int] = None,
        error_summary: Optional[str] = None,
        max_entry_size: int = 1048576,
        note: Optional[str] = None,
        tag: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Ghi nhận lượt chạy F5.
        Gọi trực tiếp vào SQLite WAL (mất < 0.3ms) để trả ngay `entry_id` cho UI
        phục vụ cập nhật kết quả khi query kết thúc. Mọi lỗi được bắt và log an toàn,
        không bao giờ ném ngoại lệ làm gián đoạn F5.
        """
        try:
            self._write_count += 1
            if self._write_count % 100 == 0:
                try:
                    self._queue.put_nowait(("PURGE", {}))
                except Exception:
                    pass

            return self.store.record_execution(
                doc_id=doc_id,
                display_name=display_name,
                sql=sql,
                server=server,
                database=database,
                file_path=file_path,
                login=login,
                is_selection=is_selection,
                entry_type=entry_type,
                executed_at=executed_at,
                duration_ms=duration_ms,
                status=status,
                error_summary=error_summary,
                max_entry_size=max_entry_size,
                note=note,
                tag=tag
            )
        except Exception as exc:
            logger.error("[HistoryService] record_execution error: %s", exc)
            return None

    def update_entry_result(
        self,
        entry_id: int,
        duration_ms: Optional[int] = None,
        status: Optional[int] = None,
        error_summary: Optional[str] = None
    ) -> bool:
        """Cập nhật kết quả truy vấn (thời gian chạy, trạng thái, tóm tắt lỗi)."""
        try:
            return self.store.update_entry_result(
                entry_id=entry_id,
                duration_ms=duration_ms,
                status=status,
                error_summary=error_summary
            )
        except Exception as exc:
            logger.error("[HistoryService] update_entry_result error: %s", exc)
            return False

    def update_document(
        self,
        doc_id: str,
        display_name: Optional[str] = None,
        file_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """Cập nhật thông tin Document khi Save / Save As / Rename."""
        try:
            return self.store.update_document(
                doc_id=doc_id,
                display_name=display_name,
                file_path=file_path
            )
        except Exception as exc:
            logger.error("[HistoryService] update_document error: %s", exc)
            return {"success": False, "error": str(exc), "doc_id": doc_id}

    def get_document_by_path(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Tìm Document theo đường dẫn file trên đĩa."""
        try:
            return self.store.get_document_by_path(file_path)
        except Exception as exc:
            logger.error("[HistoryService] get_document_by_path error: %s", exc)
            return None

    def get_documents(
        self,
        search: Optional[str] = None,
        favorites_only: bool = False,
        server: Optional[str] = None,
        database: Optional[str] = None,
        from_timestamp: Optional[int] = None,
        to_timestamp: Optional[int] = None,
        limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Lấy danh sách Document (hỗ trợ tìm kiếm và lọc nâng cao)."""
        try:
            return self.store.get_documents(
                search=search,
                favorites_only=favorites_only,
                server=server,
                database=database,
                from_timestamp=from_timestamp,
                to_timestamp=to_timestamp,
                limit=limit
            )
        except Exception as exc:
            logger.error("[HistoryService] get_documents error: %s", exc)
            return []

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Lấy thông tin một Document."""
        try:
            return self.store.get_document(doc_id)
        except Exception as exc:
            logger.error("[HistoryService] get_document error: %s", exc)
            return None

    def get_entries(
        self,
        doc_id: str,
        status_filter: Optional[int] = None,
        search: Optional[str] = None,
        server: Optional[str] = None,
        database: Optional[str] = None,
        from_timestamp: Optional[int] = None,
        to_timestamp: Optional[int] = None,
        tag: Optional[str] = None,
        entry_type: Optional[int] = None,
        favorite_only: bool = False,
        is_favorite: Optional[bool] = None,
        limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Lấy danh sách các lần thực thi của Document (hỗ trợ lọc theo trạng thái, server, db, tag, thời gian, loại, yêu thích)."""
        try:
            return self.store.get_entries(
                doc_id=doc_id,
                status_filter=status_filter,
                search=search,
                server=server,
                database=database,
                from_timestamp=from_timestamp,
                to_timestamp=to_timestamp,
                tag=tag,
                entry_type=entry_type,
                favorite_only=favorite_only,
                is_favorite=is_favorite,
                limit=limit
            )
        except Exception as exc:
            logger.error("[HistoryService] get_entries error: %s", exc)
            return []

    def get_entry_detail(self, entry_id: int) -> Optional[Dict[str, Any]]:
        """Lấy chi tiết một entry kèm nội dung SQL giải nén và danh sách Tags."""
        try:
            return self.store.get_entry_detail(entry_id)
        except Exception as exc:
            logger.error("[HistoryService] get_entry_detail error: %s", exc)
            return None

    def set_entry_favorite(self, entry_id: int, is_favorite: Optional[bool] = None) -> bool:
        """Bật/tắt trạng thái yêu thích của một entry."""
        try:
            return self.store.set_entry_favorite(entry_id=entry_id, is_favorite=is_favorite)
        except Exception as exc:
            logger.error("[HistoryService] set_entry_favorite error: %s", exc)
            return False

    def add_entry_tag(self, entry_id: int, tag_name: str, color: Optional[str] = None) -> bool:
        """Gắn nhãn (Tag) cho một entry."""
        try:
            return self.store.add_entry_tag(entry_id=entry_id, tag_name=tag_name, color=color)
        except Exception as exc:
            logger.error("[HistoryService] add_entry_tag error: %s", exc)
            return False

    def remove_entry_tag(self, entry_id: int, tag_name: str) -> bool:
        """Gỡ nhãn (Tag) khỏi một entry."""
        try:
            return self.store.remove_entry_tag(entry_id=entry_id, tag_name=tag_name)
        except Exception as exc:
            logger.error("[HistoryService] remove_entry_tag error: %s", exc)
            return False

    def get_entry_tags(self, entry_id: int) -> List[Dict[str, Any]]:
        """Lấy danh sách các nhãn (Tag) của một entry."""
        try:
            return self.store.get_entry_tags(entry_id=entry_id)
        except Exception as exc:
            logger.error("[HistoryService] get_entry_tags error: %s", exc)
            return []

    def get_all_tags(self) -> List[Dict[str, Any]]:
        """Lấy danh sách tất cả các nhãn (Tag)."""
        try:
            return self.store.get_all_tags()
        except Exception as exc:
            logger.error("[HistoryService] get_all_tags error: %s", exc)
            return []

    def toggle_star(self, doc_id: str, is_starred: Optional[bool] = None) -> bool:
        """Bật/tắt đánh dấu sao Document."""
        try:
            return self.store.toggle_star(doc_id, is_starred)
        except Exception as exc:
            logger.error("[HistoryService] toggle_star error: %s", exc)
            return False

    def delete_entry(self, entry_id: int) -> bool:
        """Xóa an toàn một HistoryEntry."""
        try:
            return self.store.delete_entry(entry_id)
        except Exception as exc:
            logger.error("[HistoryService] delete_entry error: %s", exc)
            return False

    def delete_document(self, doc_id: str) -> bool:
        """Xóa lịch sử của một Document."""
        try:
            return self.store.delete_document(doc_id)
        except Exception as exc:
            logger.error("[HistoryService] delete_document error: %s", exc)
            return False

    def purge_old_entries(
        self,
        max_age_days: int = 90,
        max_entries_per_doc: int = 200,
        max_db_size_mb: int = 500
    ) -> Dict[str, int]:
        """Dọn dẹp các bản ghi quá hạn."""
        try:
            return self.store.purge_old_entries(
                max_age_days=max_age_days,
                max_entries_per_doc=max_entries_per_doc,
                max_db_size_mb=max_db_size_mb
            )
        except Exception as exc:
            logger.error("[HistoryService] purge_old_entries error: %s", exc)
            return {"purged_entries": 0}

    def compact(self) -> Dict[str, Any]:
        """Tối ưu và thu gọn cơ sở dữ liệu (VACUUM + incremental_vacuum)."""
        try:
            return self.store.compact()
        except Exception as exc:
            logger.error("[HistoryService] compact error: %s", exc)
            return self.get_storage_stats()

    def clear_all(self, keep_favorites: bool = False) -> Dict[str, Any]:
        """Xóa toàn bộ lịch sử truy vấn (tùy chọn giữ lại favorites)."""
        try:
            return self.store.clear_all(keep_favorites=keep_favorites)
        except Exception as exc:
            logger.error("[HistoryService] clear_all error: %s", exc)
            return self.get_storage_stats()

    def get_storage_stats(self) -> Dict[str, Any]:
        """Lấy thống kê dung lượng lưu trữ."""
        try:
            return self.store.get_storage_stats()
        except Exception as exc:
            logger.error("[HistoryService] get_storage_stats error: %s", exc)
            return {}

    def update_entry_note(self, entry_id: int, note: Optional[str] = None, tag: Optional[str] = None) -> bool:
        """Cập nhật ghi chú và nhãn cho một entry."""
        try:
            return self.store.update_entry_note(entry_id=entry_id, note=note, tag=tag)
        except Exception as exc:
            logger.error("[HistoryService] update_entry_note error: %s", exc)
            return False

    def get_distinct_filters(self) -> Dict[str, List[str]]:
        """Lấy danh sách các Server, Database, Tag độc nhất trong lịch sử."""
        try:
            return self.store.get_distinct_filters()
        except Exception as exc:
            logger.error("[HistoryService] get_distinct_filters error: %s", exc)
            return {"servers": [], "databases": [], "tags": []}

    def export_history(self, doc_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Xuất dữ liệu lịch sử thành JSON dictionary."""
        try:
            return self.store.export_history(doc_ids=doc_ids)
        except Exception as exc:
            logger.error("[HistoryService] export_history error: %s", exc)
            return {"success": False, "error": str(exc)}

    def import_history(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Nhập dữ liệu lịch sử từ JSON export."""
        try:
            return self.store.import_history(data=data)
        except Exception as exc:
            logger.error("[HistoryService] import_history error: %s", exc)
            return {"success": False, "error": str(exc)}

    def flush(self, timeout: float = 2.0):
        """Đợi hàng đợi xử lý xong trước khi thoát ứng dụng."""
        try:
            self._queue.join()
        except Exception:
            pass

    def close(self, timeout: float = 2.0):
        """Đóng service an toàn."""
        self._stop_event.set()
        try:
            self._retention_timer.cancel()
        except Exception:
            pass
        self.flush(timeout=timeout)
        self.store.close()

    shutdown = close


def get_history_service(db_path: Optional[str] = None) -> HistoryService:
    """Lấy singleton instance của HistoryService."""
    return HistoryService.get_instance(db_path=db_path)
