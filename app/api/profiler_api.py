# -*- coding: utf-8 -*-
"""
Profiler API Mixin.
Handles trace starting, stopping, pausing, resuming, status polling, and trace connection listing.
"""
import logging
from app.services.settings_store import CONNECTIONS_FILE, _read_json
from app.utils.crypto import decrypt_password

logger = logging.getLogger("luobtool.api.profiler")


class ProfilerApiMixin:
    def profiler_list_connections(self):
        try:
            saved = _read_json(CONNECTIONS_FILE, [])
            sanitized_saved = []
            for d in saved:
                item = dict(d)
                db_type = (item.get("type") or "").strip().lower()
                if db_type == "group_marker" or str(item.get("name", "")).startswith("__group__"):
                    continue
                item["supported"] = db_type in ("sqlserver", "mssql", "sql_server", "postgres", "postgresql", "pgsql")
                if item.get("password"):
                    item["has_password"] = True
                    item.pop("password", None)
                else:
                    item["has_password"] = False
                sanitized_saved.append(item)
            return {"success": True, "connections": sanitized_saved}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def profiler_start_trace(self, conn_id=None, conn_config=None, target_win=None):
        try:
            from app.services.profiler import profiler_service

            target_cfg = None
            if conn_config and isinstance(conn_config, dict):
                target_cfg = dict(conn_config)
            elif conn_id:
                saved = _read_json(CONNECTIONS_FILE, [])
                for p in saved:
                    if p.get("id") == conn_id or str(p.get("name", "")).strip().lower() == str(conn_id).strip().lower():
                        target_cfg = dict(p)
                        break

            if not target_cfg:
                return {"success": False, "error": f"Không tìm thấy cấu hình kết nối {conn_id}"}

            db_t = (target_cfg.get("type") or "").lower()
            if db_t == "group_marker" or str(target_cfg.get("name", "")).startswith("__group__"):
                return {"success": False, "error": "Không thể bắt đầu trace trên nhóm."}

            if target_cfg.get("password"):
                target_cfg["password"] = decrypt_password(target_cfg["password"])
            elif not target_cfg.get("password") and target_cfg.get("id"):
                pwd = self.cm.get_cached_password(target_cfg)
                if pwd:
                    target_cfg["password"] = pwd

            if not target_win:
                if hasattr(self, '_profiler_windows') and self._profiler_windows:
                    target_win = self._profiler_windows[-1]
                if not target_win:
                    target_win = getattr(self, '_window', None)

            res = profiler_service.start_trace(target_cfg, target_window=target_win)
            return res
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def profiler_pause_trace(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.pause_trace(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def profiler_resume_trace(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.resume_trace(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def profiler_stop_trace(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.stop_trace(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def profiler_get_status(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.get_status(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

