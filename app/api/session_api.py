# -*- coding: utf-8 -*-
"""
Session Persistence API Mixin.
Handles saving, loading, and clearing user UI/workspace sessions.
"""
import logging

logger = logging.getLogger("luobtool.api.session")


class SessionApiMixin:
    def session_save(self, session_data):
        try:
            from app.routes.session import save_session_data
            return save_session_data(session_data)
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def session_load(self):
        try:
            from app.routes.session import load_session_data
            return load_session_data()
        except Exception as exc:
            return {"success": False, "error": str(exc), "session": None}


    def session_clear(self):
        try:
            from app.routes.session import clear_session_data
            return clear_session_data()
        except Exception as exc:
            return {"success": False, "error": str(exc)}

