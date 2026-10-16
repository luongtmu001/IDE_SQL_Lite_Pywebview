# -*- coding: utf-8 -*-
"""
Activity & Session Monitor API Mixin.
Exposes database session list, blocking chains, and safe cancellation/termination
to pywebview desktop and web API routes.
"""
import logging
from typing import Any, Dict, Optional
from app.services.activity_service import ActivityService

logger = logging.getLogger("luobtool.api.activity")


class ActivityApiMixin:
    """API mixin for Session & Blocking Locks Monitor."""

    def activity_get_sessions(self, connection_id: str, database: Optional[str] = None, active_only: bool = False) -> Dict[str, Any]:
        """Returns snapshot of active sessions, queries, and blocking dependencies."""
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            return ActivityService.get_activity_snapshot(conn, database=database, active_only=active_only)
        except Exception as exc:
            logger.exception("Error in activity_get_sessions for %s: %s", connection_id, exc)
            return {"success": False, "error": str(exc)}

    def activity_cancel_session(self, connection_id: str, session_id: int) -> Dict[str, Any]:
        """Cancels running query on target session."""
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            return ActivityService.cancel_session(conn, target_id=int(session_id))
        except Exception as exc:
            logger.exception("Error cancelling session %s on %s: %s", session_id, connection_id, exc)
            return {"success": False, "error": str(exc)}

    def activity_kill_session(self, connection_id: str, session_id: int) -> Dict[str, Any]:
        """Terminates target session/connection on database."""
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            return ActivityService.kill_session(conn, target_id=int(session_id))
        except Exception as exc:
            logger.exception("Error killing session %s on %s: %s", session_id, connection_id, exc)
            return {"success": False, "error": str(exc)}

    def activity_get_current_spid(self, connection_id: str) -> Dict[str, Any]:
        """Returns current session SPID/PID."""
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            spid = ActivityService.get_current_session_id(conn)
            return {"success": True, "spid": spid}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def open_activity_monitor_window(self, connection_id: Optional[str] = None, db_type: Optional[str] = None) -> Dict[str, Any]:
        """Opens Activity Monitor in an independent desktop window (Pop-out mode)."""
        try:
            from app.desktop.windows import open_activity_monitor_window
            return open_activity_monitor_window(self, conn_id=connection_id, db_type=db_type)
        except Exception as exc:
            logger.exception("Error opening activity monitor window: %s", exc)
            return {"success": False, "error": str(exc)}
