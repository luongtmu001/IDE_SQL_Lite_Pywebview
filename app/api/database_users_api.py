# -*- coding: utf-8 -*-
"""
Database Users & Roles API Mixin for pywebview IPC and backend routing.
"""
import logging
from app.services.database_users.service import DatabaseUsersService

logger = logging.getLogger("luobtool.api.database_users")


class DatabaseUsersApiMixin:
    """
    API endpoints for listing users/roles, memberships, permissions, and script generation.
    """

    def list_database_users(self, connection_id, database=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable.", "items": []}

            service = DatabaseUsersService(conn.adapter)
            items = service.list_principals(database=database)
            return {"success": True, "items": items}
        except Exception as exc:
            logger.exception("Error in list_database_users: %s", exc)
            return {"success": False, "error": str(exc), "items": []}

    def get_database_user_memberships(self, connection_id, principal_name, database=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable.", "items": []}

            service = DatabaseUsersService(conn.adapter)
            items = service.get_role_memberships(principal_name, database=database)
            return {"success": True, "items": items}
        except Exception as exc:
            logger.exception("Error in get_database_user_memberships: %s", exc)
            return {"success": False, "error": str(exc), "items": []}

    def get_database_user_permissions(self, connection_id, principal_name, database=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable.", "items": []}

            service = DatabaseUsersService(conn.adapter)
            items = service.get_permissions(principal_name, database=database)
            return {"success": True, "items": items}
        except Exception as exc:
            logger.exception("Error in get_database_user_permissions: %s", exc)
            return {"success": False, "error": str(exc), "items": []}

    def get_database_user_properties(self, connection_id, principal_name, database=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable.", "data": {}}

            service = DatabaseUsersService(conn.adapter)
            data = service.get_properties(principal_name, database=database)
            return {"success": True, "data": data}
        except Exception as exc:
            logger.exception("Error in get_database_user_properties: %s", exc)
            return {"success": False, "error": str(exc), "data": {}}

    def script_database_user(self, connection_id, principal_name, action="CREATE", mode="basic", database=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable.", "script": ""}

            conn_name = getattr(conn, "config", {}).get("name") or str(connection_id)
            service = DatabaseUsersService(conn.adapter)
            script = service.generate_script(
                principal_name=principal_name,
                action=action,
                mode=mode,
                database=database,
                connection_name=conn_name
            )
            return {"success": True, "script": script}
        except Exception as exc:
            logger.exception("Error in script_database_user: %s", exc)
            return {"success": False, "error": str(exc), "script": ""}
