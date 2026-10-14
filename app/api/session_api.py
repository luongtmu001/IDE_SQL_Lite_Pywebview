# -*- coding: utf-8 -*-
"""
Session Persistence API Mixin.
Handles saving, loading, and clearing user UI/workspace sessions via app.services.session_service.
"""
import logging

from app.services.session_service import (
    clear_session_data,
    load_session_data,
    save_session_data,
)

logger = logging.getLogger("luobtool.api.session")


class SessionApiMixin:
    def session_save(self, session_data):
        try:
            return save_session_data(session_data)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def session_load(self):
        try:
            return load_session_data()
        except Exception as exc:
            return {"success": False, "error": str(exc), "session": None}

    def session_clear(self):
        try:
            return clear_session_data()
        except Exception as exc:
            return {"success": False, "error": str(exc)}
