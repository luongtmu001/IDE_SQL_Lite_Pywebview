# -*- coding: utf-8 -*-
"""
Profiler Service Coordinator.
Manages profiler session lifecycle, thread coordination, and window binding.
"""

import logging
import uuid
from typing import Any, Dict, Optional

from .base import BaseProfilerSession
from .mssql_profiler import MssqlProfilerSession
from .postgres_profiler import PostgresProfilerSession

logger = logging.getLogger("luobtool.profiler.service")


class ProfilerService:
    def __init__(self):
        self.active_sessions: Dict[str, BaseProfilerSession] = {}

    def start_trace(
        self,
        conn_config: Dict[str, Any],
        target_window: Any = None,
        custom_session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Creates and starts a profiler session for the given connection profile."""
        session_id = custom_session_id or f"trace_{uuid.uuid4().hex[:8]}"

        # Stop any existing session for the same session_id
        if session_id in self.active_sessions:
            self.stop_trace(session_id)

        db_type = (conn_config.get("type") or "").strip().lower()

        session: BaseProfilerSession
        if db_type in ("sqlserver", "mssql", "sql_server"):
            session = MssqlProfilerSession(session_id, conn_config)
        elif db_type in ("postgres", "postgresql", "pgsql"):
            session = PostgresProfilerSession(session_id, conn_config)
        else:
            return {
                "success": False,
                "error": f"Hệ quản trị '{db_type}' hiện chưa được hỗ trợ Profiler. Chỉ hỗ trợ SQL Server và PostgreSQL.",
            }

        if target_window is not None:
            session.set_target_window(target_window)

        ok = session.start()
        if not ok:
            return {
                "success": False,
                "error": session.error_message or "Không thể khởi động phiên giám sát.",
            }

        self.active_sessions[session_id] = session
        return {
            "success": True,
            "session_id": session_id,
            "db_type": db_type,
            "message": f"Phiên Profiler [{session_id}] đã khởi chạy thành công.",
        }

    def pause_trace(self, session_id: str) -> Dict[str, Any]:
        session = self.active_sessions.get(session_id)
        if not session:
            return {"success": False, "error": f"Không tìm thấy phiên trace {session_id}"}
        session.pause()
        return {"success": True, "session_id": session_id, "is_paused": True}

    def resume_trace(self, session_id: str) -> Dict[str, Any]:
        session = self.active_sessions.get(session_id)
        if not session:
            return {"success": False, "error": f"Không tìm thấy phiên trace {session_id}"}
        session.resume()
        return {"success": True, "session_id": session_id, "is_paused": False}

    def stop_trace(self, session_id: str) -> Dict[str, Any]:
        session = self.active_sessions.pop(session_id, None)
        if not session:
            return {"success": True, "message": "Phiên đã dừng hoặc không tồn tại"}
        session.stop()
        return {"success": True, "session_id": session_id, "is_running": False}

    def stop_all(self):
        """Stops all running profiler sessions."""
        sessions = list(self.active_sessions.values())
        self.active_sessions.clear()
        for s in sessions:
            try:
                s.stop()
            except Exception as e:
                logger.warning("Error stopping session %s: %s", s.session_id, e)

    def get_status(self, session_id: str) -> Dict[str, Any]:
        session = self.active_sessions.get(session_id)
        if not session:
            return {"success": False, "error": "Phiên không tồn tại"}
        status = session.get_status()
        status["success"] = True
        return status


profiler_service = ProfilerService()
