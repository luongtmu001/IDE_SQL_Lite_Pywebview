# -*- coding: utf-8 -*-
"""
ResultShape Detector Factory.
"""
from typing import Any
from .base import ResultShapeDetector
from .parser import (
    clean_identifier,
    extract_columns_from_select_clause,
    parse_create_table_columns,
    parse_postgres_cursors,
    parse_sql_server_selects,
)
from .postgresql import PostgresResultShapeDetector
from .sqlserver import SqlServerResultShapeDetector


def get_detector(connection_manager: Any, connection_id: str, owner_session_id: str = "main") -> ResultShapeDetector:
    """Instantiate appropriate ResultShapeDetector based on connection db_type."""
    conn = None
    try:
        conn = connection_manager.get(owner_session_id, connection_id)
    except Exception:
        # Fallback to direct lookup in _connections
        conns_dict = getattr(connection_manager, "_connections", {})
        if connection_id in conns_dict:
            conn = conns_dict[connection_id]
        else:
            clean_target = str(connection_id).strip().lower()
            for c in conns_dict.values():
                cfg = getattr(c, "config", {}) or {}
                cid = str(cfg.get("id") or getattr(c, "connection_id", "")).strip().lower()
                cname = str(cfg.get("name") or "").strip().lower()
                if cid == clean_target or cname == clean_target:
                    conn = c
                    break

    if not conn:
        # Try to activate from saved profiles
        try:
            from app.services.settings_store import get_saved_connections
            from app.utils.crypto import decrypt_password
            clean_target = str(connection_id).strip().lower()
            saved = get_saved_connections(filter_groups=False) or []
            for p in saved:
                if not p or p.get("type") == "group_marker":
                    continue
                pid = str(p.get("id") or "").strip().lower()
                pname = str(p.get("name") or "").strip().lower()
                if pid == clean_target or pname == clean_target:
                    cfg = dict(p)
                    if cfg.get("password") and not cfg.get("trusted_connection"):
                        try:
                            cfg["password"] = decrypt_password(cfg["password"])
                        except Exception:
                            pass
                    conn, _ = connection_manager.create_or_get(owner_session_id, cfg)
                    break
        except Exception:
            pass

    if not conn:
        raise ValueError(f"Không tìm thấy kết nối ID '{connection_id}'.")

    # Use the runtime connection_id of the actual connection object if available
    actual_conn_id = getattr(conn, "connection_id", connection_id)

    db_type = getattr(conn, "db_type", None)
    if not db_type and hasattr(conn, "adapter"):
        db_type = getattr(conn.adapter, "db_type", "")
    db_type = str(db_type or "").lower()

    if "postgres" in db_type:
        return PostgresResultShapeDetector(connection_manager, actual_conn_id)
    else:
        return SqlServerResultShapeDetector(connection_manager, actual_conn_id)


__all__ = [
    "ResultShapeDetector",
    "PostgresResultShapeDetector",
    "SqlServerResultShapeDetector",
    "get_detector",
    "clean_identifier",
    "extract_columns_from_select_clause",
    "parse_create_table_columns",
    "parse_postgres_cursors",
    "parse_sql_server_selects",
]
