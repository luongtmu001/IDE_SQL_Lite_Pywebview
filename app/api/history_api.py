# -*- coding: utf-8 -*-
"""
Query History API Mixin.
Handles query execution history logging, searches, statistics, bookmarks, tags,
and query history window launching.
"""
import json
import logging
import os
import subprocess
from app.desktop.windows import open_query_history_window as _desktop_open_query_history_window
from app.services.history import get_history_service
from app.services.settings_store import _load_settings_file

logger = logging.getLogger("luobtool.api.history")


class HistoryApiMixin:
    def open_query_history_window(self):
        return _desktop_open_query_history_window(self)


    def history_log_execution(self, payload):
        try:
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            doc_id = payload.get("doc_id")
            if not doc_id:
                return {"success": False, "error": "doc_id is required"}
            # Kiểm tra thiết lập bật/tắt ghi lịch sử (history.enabled)
            settings = _load_settings_file()
            history_cfg = settings.get("history", {})
            if not history_cfg.get("enabled", True):
                return {"success": True, "entry_id": None, "disabled": True}

            max_entry_size = int(history_cfg.get("maxEntrySizeKb", 1024)) * 1024
            svc = get_history_service()
            res = svc.record_execution(
                doc_id=doc_id,
                display_name=payload.get("display_name") or "Untitled.sql",
                sql=payload.get("sql") or "",
                server=payload.get("server") or "localhost",
                database=payload.get("database") or "master",
                file_path=payload.get("file_path"),
                login=payload.get("login"),
                is_selection=bool(payload.get("is_selection", False)),
                entry_type=int(payload.get("entry_type", 1)),
                executed_at=payload.get("executed_at"),
                duration_ms=payload.get("duration_ms"),
                status=payload.get("status"),
                error_summary=payload.get("error_summary"),
                max_entry_size=max_entry_size
            )
            if res is None:
                return {"success": True, "entry_id": None, "skipped": True}
            return {"success": True, **res}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_update_execution(self, payload):
        try:
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            entry_id = payload.get("entry_id")
            if entry_id is None:
                return {"success": False, "error": "entry_id is required"}
            svc = get_history_service()
            updated = svc.update_entry_result(
                entry_id=int(entry_id),
                duration_ms=payload.get("duration_ms"),
                status=payload.get("status"),
                error_summary=payload.get("error_summary")
            )
            return {"success": True, "updated": updated}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_update_document(self, payload):
        try:
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            doc_id = payload.get("doc_id")
            if not doc_id:
                return {"success": False, "error": "doc_id is required"}
            svc = get_history_service()
            return svc.update_document(
                doc_id=doc_id,
                display_name=payload.get("display_name"),
                file_path=payload.get("file_path")
            )
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_document_by_path(self, file_path):
        try:
            svc = get_history_service()
            doc = svc.get_document_by_path(file_path)
            return {"success": True, "document": doc}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_documents(self, search=None, favorites_only=False, limit=200, server=None, database=None, from_timestamp=None, to_timestamp=None):
        try:
            svc = get_history_service()
            docs = svc.get_documents(
                search=search,
                favorites_only=bool(favorites_only),
                server=server,
                database=database,
                from_timestamp=from_timestamp,
                to_timestamp=to_timestamp,
                limit=int(limit or 200)
            )
            return {"success": True, "documents": docs}
        except Exception as exc:
            return {"success": False, "error": str(exc), "documents": []}


    def history_get_document(self, doc_id):
        try:
            svc = get_history_service()
            doc = svc.get_document(doc_id)
            if not doc:
                return {"success": False, "error": "Document not found"}
            return {"success": True, "document": doc}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_entries(self, doc_id, status=None, limit=200, server=None, database=None, from_timestamp=None, to_timestamp=None, tag=None, entry_type=None, search=None):
        try:
            svc = get_history_service()
            status_filter = int(status) if status is not None and status != "" else None
            entries = svc.get_entries(
                doc_id=doc_id,
                status_filter=status_filter,
                search=search,
                server=server,
                database=database,
                from_timestamp=from_timestamp,
                to_timestamp=to_timestamp,
                tag=tag,
                entry_type=entry_type,
                limit=int(limit or 200)
            )
            return {"success": True, "entries": entries}
        except Exception as exc:
            return {"success": False, "error": str(exc), "entries": []}


    def history_get_entry_detail(self, entry_id):
        try:
            svc = get_history_service()
            detail = svc.get_entry_detail(int(entry_id))
            if not detail:
                return {"success": False, "error": "Entry not found"}
            return {"success": True, "entry": detail}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_toggle_star(self, doc_id, is_starred=None):
        try:
            svc = get_history_service()
            val = svc.toggle_star(doc_id=doc_id, is_starred=is_starred)
            return {"success": True, "is_starred": val}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_delete_entry(self, entry_id):
        try:
            svc = get_history_service()
            ok = svc.delete_entry(int(entry_id))
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_delete_document(self, doc_id):
        try:
            svc = get_history_service()
            ok = svc.delete_document(doc_id)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_purge(self, max_age_days=None, max_entries_per_doc=None, max_db_size_mb=None):
        try:
            settings = _load_settings_file()
            history_cfg = settings.get("history", {})
            if max_age_days is None:
                max_age_days = int(history_cfg.get("maxAgeDays", 90))
            if max_entries_per_doc is None:
                max_entries_per_doc = int(history_cfg.get("maxEntriesPerDoc", 200))
            if max_db_size_mb is None:
                max_db_size_mb = int(history_cfg.get("maxDbSizeMb", 500))

            svc = get_history_service()
            res = svc.purge_old_entries(
                max_age_days=int(max_age_days),
                max_entries_per_doc=int(max_entries_per_doc),
                max_db_size_mb=int(max_db_size_mb)
            )
            return {"success": True, **res}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_compact(self):
        try:
            svc = get_history_service()
            stats = svc.compact()
            return {"success": True, "stats": stats}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_clear_all(self, keep_favorites=False):
        try:
            svc = get_history_service()
            stats = svc.clear_all(keep_favorites=keep_favorites)
            return {"success": True, "stats": stats}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_stats(self):
        try:
            svc = get_history_service()
            st = svc.get_storage_stats()
            return {"success": True, "stats": st}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_open_in_editor(self, payload):
        try:
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            sql = payload.get("sql", "")
            title = payload.get("title") or "SQLQuery.sql"
            server = payload.get("server")
            database = payload.get("database")

            if self._window:
                js_code = (
                    f"if (typeof window.openHistoryQueryInNewTab === 'function') {{"
                    f"  window.openHistoryQueryInNewTab({json.dumps(sql)}, {json.dumps(title)}, {json.dumps(server)}, {json.dumps(database)});"
                    f"}}"
                )
                self._window.evaluate_js(js_code)
                try:
                    self._window.focus()
                except Exception:
                    pass
                return {"success": True}
            return {"success": False, "error": "Main window reference not found"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_open_containing_folder(self, file_path):
        try:
            if not file_path or not os.path.exists(file_path):
                return {"success": False, "error": "File does not exist on disk"}
            import subprocess
            subprocess.Popen(f'explorer /select,"{os.path.normpath(file_path)}"')
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_open_diff_in_editor(self, payload):
        try:
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            original_sql = payload.get("original_sql", "")
            modified_sql = payload.get("modified_sql", "")
            original_title = payload.get("original_title") or "Previous Version"
            modified_title = payload.get("modified_title") or "Current Version"

            if self._window:
                js_code = (
                    f"if (typeof window.showDiffView === 'function') {{"
                    f"  window.showDiffView({json.dumps(original_sql)}, {json.dumps(modified_sql)}, {json.dumps(original_title)}, {json.dumps(modified_title)}, 'sql');"
                    f"}}"
                )
                self._window.evaluate_js(js_code)
                try:
                    self._window.focus()
                except Exception:
                    pass
                return {"success": True}
            return {"success": False, "error": "Main window reference not found"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_active_editor_content(self):
        try:
            if self._window:
                code = "window.AppEditor ? window.AppEditor.getValue() : ''"
                content = self._window.evaluate_js(code)
                return {"success": True, "content": content or ""}
            return {"success": False, "error": "Main window reference not found", "content": ""}
        except Exception as exc:
            return {"success": False, "error": str(exc), "content": ""}


    def history_update_entry_note(self, entry_id, note=None, tag=None):
        try:
            svc = get_history_service()
            ok = svc.update_entry_note(int(entry_id), note=note, tag=tag)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_filters(self):
        try:
            svc = get_history_service()
            data = svc.get_distinct_filters()
            return {"success": True, "filters": data}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_export(self, payload=None):
        try:
            doc_ids = None
            if isinstance(payload, dict):
                doc_ids = payload.get("doc_ids")
            svc = get_history_service()
            res = svc.export_history(doc_ids=doc_ids)
            return {"success": True, **res}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_import(self, payload):
        try:
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            svc = get_history_service()
            res = svc.import_history(payload)
            return {"success": True, **res}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_set_entry_favorite(self, entry_id, is_favorite=None):
        try:
            svc = get_history_service()
            val = svc.set_entry_favorite(int(entry_id), is_favorite=is_favorite)
            return {"success": True, "is_favorite": val}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_add_entry_tag(self, entry_id, tag_name, color=None):
        try:
            svc = get_history_service()
            ok = svc.add_entry_tag(int(entry_id), tag_name=str(tag_name), color=color)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_remove_entry_tag(self, entry_id, tag_name):
        try:
            svc = get_history_service()
            ok = svc.remove_entry_tag(int(entry_id), tag_name=str(tag_name))
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def history_get_entry_tags(self, entry_id):
        try:
            svc = get_history_service()
            tags = svc.get_entry_tags(int(entry_id))
            return {"success": True, "tags": tags}
        except Exception as exc:
            return {"success": False, "error": str(exc), "tags": []}


    def history_get_tags(self):
        try:
            svc = get_history_service()
            tags = svc.get_all_tags()
            return {"success": True, "tags": tags}
        except Exception as exc:
            return {"success": False, "error": str(exc), "tags": []}

