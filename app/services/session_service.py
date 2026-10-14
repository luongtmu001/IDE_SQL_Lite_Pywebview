# -*- coding: utf-8 -*-
"""
Session Persistence Service.
Manages saving and restoring IDE workspaces, tab contexts, cursor positions, and splitters.
Shared by pywebview Native API (SessionApiMixin) and Flask routes (session_bp).
"""
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Set

from app.services.settings_store import (
    CONNECTIONS_FILE as STORE_CONNECTIONS_FILE,
    DATA_DIR as STORE_DATA_DIR,
    SETTINGS_FILE as STORE_SETTINGS_FILE,
    load_settings,
    read_json,
)

logger = logging.getLogger("luobtool.session_service")

DATA_DIR = STORE_DATA_DIR
SESSION_FILE = DATA_DIR / "session.json"
SETTINGS_FILE = STORE_SETTINGS_FILE
CONNECTIONS_FILE = STORE_CONNECTIONS_FILE

SESSION_FILE_PATH = SESSION_FILE
SETTINGS_FILE_PATH = SETTINGS_FILE
CONNECTIONS_FILE_PATH = CONNECTIONS_FILE


def get_active_connection_ids(connections_file: Optional[Path] = None) -> Set[str]:
    """Retrieve active connection IDs from connections.json to validate tab sessions."""
    target_conn_file = Path(connections_file or CONNECTIONS_FILE)
    try:
        if target_conn_file.exists():
            with open(target_conn_file, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
        else:
            data = read_json(target_conn_file, [])
        if isinstance(data, list):
            return {str(item.get("id")) for item in data if isinstance(item, dict) and item.get("id")}
        elif isinstance(data, dict) and "connections" in data and isinstance(data["connections"], list):
            return {str(item.get("id")) for item in data["connections"] if isinstance(item, dict) and item.get("id")}
    except Exception as exc:
        logger.warning("[Session] Failed to load connections: %s", exc)
    return set()


def atomic_write_json(file_path: Path, data: dict) -> bool:
    """Atomic write for JSON files to prevent data corruption during sudden shutdowns."""
    try:
        target_path = Path(file_path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target_path.with_suffix(".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target_path)
        return True
    except Exception as exc:
        logger.error("[Session] Atomic write failed for %s: %s", file_path, exc)
        try:
            if "tmp_path" in locals() and tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
        return False


def save_session_data(
    payload: dict,
    session_file: Optional[Path] = None,
    settings_file: Optional[Path] = None,
) -> dict:
    """Sanitize and persist session data safely."""
    if not isinstance(payload, dict):
        return {"success": False, "error": "payload must be a JSON object"}

    target_session_file = Path(session_file or SESSION_FILE)
    target_settings_file = Path(settings_file or SETTINGS_FILE)

    settings = {}
    if target_settings_file.exists():
        try:
            with open(target_settings_file, "r", encoding="utf-8-sig") as f:
                settings = json.load(f)
        except Exception:
            settings = {}
    else:
        settings = load_settings() or {}

    session_cfg = settings.get("session", {}) if isinstance(settings, dict) else {}
    save_content = bool(session_cfg.get("saveSqlContent", True))
    max_size = int(session_cfg.get("maxTabSizeBytes", 1048576))  # 1 MB default

    clean_tabs = []
    tabs_raw = payload.get("tabs", [])
    if isinstance(tabs_raw, list):
        for t in tabs_raw:
            if not isinstance(t, dict):
                continue
            tab_copy = dict(t)

            # Security: Never persist passwords or credentials
            for sensitive_key in ["password", "pwd", "authPassword", "credentials", "secret"]:
                tab_copy.pop(sensitive_key, None)

            # Handle SQL draft content truncation
            if not save_content:
                tab_copy.pop("content", None)
            else:
                content = tab_copy.get("content", "")
                if isinstance(content, str) and len(content.encode("utf-8")) > max_size:
                    slice_len = min(len(content), max(0, min(max_size, 65536)))
                    tab_copy["content"] = content[:slice_len] + "\n-- [TRUNCATED: Nội dung tab vượt quá giới hạn cấu hình session] --\n"
                    tab_copy["contentTruncated"] = True

            clean_tabs.append(tab_copy)

    clean_payload = {
        "version": 1,
        "savedAt": payload.get("savedAt") or int(os.times().elapsed * 1000),
        "activeTabId": payload.get("activeTabId"),
        "sidebarWidth": payload.get("sidebarWidth", 260),
        "sidebarCollapsed": bool(payload.get("sidebarCollapsed", False)),
        "resultsHeight": payload.get("resultsHeight", 280),
        "defaultContext": payload.get("defaultContext", {}),
        "tabs": clean_tabs,
    }

    ok = atomic_write_json(target_session_file, clean_payload)
    return {"success": ok}


def load_session_data(
    session_file: Optional[Path] = None,
    settings_file: Optional[Path] = None,
    connections_file: Optional[Path] = None,
) -> dict:
    """Load and validate session data prior to restore."""
    target_session_file = Path(session_file or SESSION_FILE)
    target_settings_file = Path(settings_file or SETTINGS_FILE)
    target_connections_file = Path(connections_file or CONNECTIONS_FILE)

    settings = {}
    if target_settings_file.exists():
        try:
            with open(target_settings_file, "r", encoding="utf-8-sig") as f:
                settings = json.load(f)
        except Exception:
            settings = {}
    else:
        settings = load_settings() or {}

    session_cfg = settings.get("session", {}) if isinstance(settings, dict) else {}
    restore_enabled = bool(session_cfg.get("restoreOnStartup", True))

    if not restore_enabled:
        return {"success": True, "session": None, "enabled": False, "tabs": [], "disabled": True}

    if not target_session_file.exists():
        return {"success": True, "session": None, "enabled": True, "tabs": []}

    try:
        with open(target_session_file, "r", encoding="utf-8-sig") as f:
            session = json.load(f)
    except Exception as exc:
        logger.error("[Session] Error reading session file: %s", exc)
        return {"success": False, "error": str(exc), "session": None, "tabs": []}

    if not isinstance(session, dict):
        return {"success": True, "session": None, "enabled": True, "tabs": []}

    # Connection integrity check: mark tab disconnected if profile deleted
    active_conn_ids = get_active_connection_ids(connections_file=target_connections_file)
    tabs = session.get("tabs", [])
    if isinstance(tabs, list):
        for t in tabs:
            if isinstance(t, dict):
                c_id = t.get("connectionId")
                if c_id and (active_conn_ids and str(c_id) not in active_conn_ids):
                    t["connectionLost"] = True
                    t["originalConnectionName"] = t.get("connectionName")
                    t["connectionId"] = None
                    t["connectionName"] = None
                else:
                    t.setdefault("connectionLost", False)

    return {
        "success": True,
        "session": session,
        "enabled": True,
        "tabs": session.get("tabs", []),
        "activeTabId": session.get("activeTabId"),
    }


def clear_session_data(session_file: Optional[Path] = None) -> dict:
    """Remove session file from disk."""
    target_session_file = Path(session_file or SESSION_FILE)
    try:
        if target_session_file.exists():
            target_session_file.unlink()
        return {"success": True}
    except Exception as exc:
        logger.error("[Session] Error clearing session: %s", exc)
        return {"success": False, "error": str(exc)}
