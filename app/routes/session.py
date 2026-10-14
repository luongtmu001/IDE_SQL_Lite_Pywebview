"""
Session Persistence Routes — luoBTool IDE
Quản lý lưu và khôi phục phiên làm việc (Session Save & Restore) cho Web và Desktop API:
- Tự động lưu trạng thái các Tab, vị trí con trỏ (cursor), scroll, kết nối
- Cơ chế atomic write chống hỏng file khi crash/đột ngột mất nguồn
- Bảo mật: Tuyệt đối không lưu mật khẩu / credentials vào session file
- Kiểm tra toàn vẹn: Xử lý an toàn khi connection profile đã bị xóa
"""

import os
import json
import logging
from pathlib import Path
from flask import Blueprint, jsonify, request

logger = logging.getLogger("app.routes.session")

session_bp = Blueprint("session", __name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
SESSION_FILE = DATA_DIR / "session.json"
CONNECTIONS_FILE = DATA_DIR / "connections.json"
SETTINGS_FILE = DATA_DIR / "settings.json"

SESSION_FILE_PATH = SESSION_FILE
SETTINGS_FILE_PATH = SETTINGS_FILE
CONNECTIONS_FILE_PATH = CONNECTIONS_FILE


def _load_settings():
    try:
        settings_path = Path(SETTINGS_FILE)
        if settings_path.exists():
            with open(settings_path, "r", encoding="utf-8-sig") as f:
                return json.load(f)
    except Exception as exc:
        logger.warning("[Session] Failed to load settings: %s", exc)
    return {}


def _get_active_connection_ids() -> set:
    try:
        conn_path = Path(CONNECTIONS_FILE)
        if conn_path.exists():
            with open(conn_path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {str(item.get("id")) for item in data if isinstance(item, dict) and item.get("id")}
                elif isinstance(data, dict) and "connections" in data and isinstance(data["connections"], list):
                    return {str(item.get("id")) for item in data["connections"] if isinstance(item, dict) and item.get("id")}
    except Exception as exc:
        logger.warning("[Session] Failed to load connections: %s", exc)
    return set()


def _atomic_write_json(file_path: Path, data: dict) -> bool:
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
            if 'tmp_path' in locals() and tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
        return False


def save_session_data(payload: dict) -> dict:
    """Xử lý và lưu session data theo chuẩn an toàn."""
    if not isinstance(payload, dict):
        return {"success": False, "error": "payload must be a JSON object"}

    settings = _load_settings()
    session_cfg = settings.get("session", {})
    save_content = bool(session_cfg.get("saveSqlContent", True))
    max_size = int(session_cfg.get("maxTabSizeBytes", 1048576)) # 1 MB default

    clean_tabs = []
    tabs_raw = payload.get("tabs", [])
    if isinstance(tabs_raw, list):
        for t in tabs_raw:
            if not isinstance(t, dict):
                continue
            tab_copy = dict(t)

            # Bảo mật: Không bao giờ lưu password hoặc credentials
            for sensitive_key in ["password", "pwd", "authPassword", "credentials", "secret"]:
                tab_copy.pop(sensitive_key, None)

            # Xử lý content SQL draft
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
        "tabs": clean_tabs
    }

    session_path = Path(SESSION_FILE)
    ok = _atomic_write_json(session_path, clean_payload)
    return {"success": ok}


def load_session_data() -> dict:
    """Tải và thẩm định phiên làm việc trước khi khôi phục."""
    settings = _load_settings()
    session_cfg = settings.get("session", {})
    restore_enabled = bool(session_cfg.get("restoreOnStartup", True))

    if not restore_enabled:
        return {"success": True, "session": None, "enabled": False, "tabs": [], "disabled": True}

    session_path = Path(SESSION_FILE)
    if not session_path.exists():
        return {"success": True, "session": None, "enabled": True, "tabs": []}

    try:
        with open(session_path, "r", encoding="utf-8-sig") as f:
            session = json.load(f)
    except Exception as exc:
        logger.error("[Session] Error reading session file: %s", exc)
        return {"success": False, "error": str(exc), "session": None, "tabs": []}

    if not isinstance(session, dict):
        return {"success": True, "session": None, "enabled": True, "tabs": []}

    # Kiểm tra toàn vẹn Connection: nếu profile kết nối đã bị xóa, tab khôi phục ở trạng thái ngắt kết nối an toàn
    active_conn_ids = _get_active_connection_ids()
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
        "activeTabId": session.get("activeTabId")
    }


def clear_session_data() -> dict:
    """Xóa file session trên đĩa."""
    try:
        session_path = Path(SESSION_FILE)
        if session_path.exists():
            session_path.unlink()
        return {"success": True}
    except Exception as exc:
        logger.error("[Session] Error clearing session: %s", exc)
        return {"success": False, "error": str(exc)}


@session_bp.post("/save")
def api_save_session():
    data = request.get_json(silent=True) or {}
    res = save_session_data(data)
    return jsonify(res)


@session_bp.get("/load")
def api_load_session():
    res = load_session_data()
    return jsonify(res)


@session_bp.post("/clear")
def api_clear_session():
    res = clear_session_data()
    return jsonify(res)
