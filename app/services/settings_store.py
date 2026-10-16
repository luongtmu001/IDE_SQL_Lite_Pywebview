# -*- coding: utf-8 -*-
"""
Settings and snippets persistence layer.
Handles reading and writing settings, snippets, and application configuration files.
"""
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.utils.paths import get_app_dir, get_bundle_dir, ensure_data_dir_migrated

logger = logging.getLogger("luobtool.settings_store")

APP_DIR = get_app_dir()
BUNDLE_DIR = get_bundle_dir()

DATA_DIR = ensure_data_dir_migrated(APP_DIR)
SETTINGS_FILE = DATA_DIR / "settings.json"
SETTINGS_FILE_ALT = APP_DIR / "settings" / "settings.json"
CONNECTIONS_FILE = DATA_DIR / "connections.json"
SNIPPETS_FILE = DATA_DIR / "snippets.json"
CODE_STYLES_FILE = DATA_DIR / "code_styles.json"
PROGRAM_LIST_FILE = DATA_DIR / "programlist.json"
PROGRAM_GROUPS_FILE = DATA_DIR / "programgroups.json"
REDGATE_SNIPPETS_DIR = None


def read_json(file_path: Path, default: Any = None) -> Any:
    """Safely read and parse a JSON file with utf-8-sig encoding and fallbacks."""
    try:
        if not file_path.exists():
            # Check BUNDLE_DIR fallback if available
            fallback = BUNDLE_DIR / "data" / file_path.name
            if fallback.exists():
                file_path = fallback
            elif hasattr(file_path, "name"):
                alt_app = APP_DIR / "data" / file_path.name
                if alt_app.exists():
                    file_path = alt_app
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8-sig") as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"[Storage] Read error {file_path}: {e}")
    return default


def write_json(file_path: Path, data: Any) -> bool:
    """Safely write JSON data with formatted indentation and utf-8 encoding."""
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"[Storage] Write error {file_path}: {e}")
        return False


def get_redgate_snippets_dir() -> Optional[Path]:
    """Retrieve custom Redgate SQL prompt snippets directory if configured."""
    try:
        settings = load_settings_file()
        custom_dir = (
            settings.get("redgate_snippets_dir")
            or settings.get("editor", {}).get("redgate_snippets_dir")
            or ""
        )
        if custom_dir and os.path.exists(custom_dir):
            return Path(custom_dir)
    except Exception:
        pass
    return None


def load_settings_file() -> Dict[str, Any]:
    """Load IDE settings with fallback defaults and schema consistency checks."""
    settings = None
    if SETTINGS_FILE.exists():
        settings = read_json(SETTINGS_FILE, None)
    if not settings and SETTINGS_FILE_ALT.exists():
        settings = read_json(SETTINGS_FILE_ALT, None)
    if not settings and (BUNDLE_DIR / "settings" / "settings.json").exists():
        settings = read_json(BUNDLE_DIR / "settings" / "settings.json", None)
    if not settings:
        settings = {
            "theme": "dark",
            "editor": {
                "fontFamily": "Consolas",
                "fontSize": 14,
                "lineHeight": 0,
                "letterSpacing": 0,
                "tabSize": 4,
                "insertSpaces": True,
                "wordWrap": False,
                "minimap": True,
                "keywordCase": "upper",
            },
            "appearance": {"theme": "dark", "iconSize": 16},
            "grid": {"fontFamily": "Segoe UI", "fontSize": 13},
            "messages": {"fontFamily": "Consolas", "fontSize": 13},
            "sql": {"maxRows": 1000, "timeoutSeconds": 30, "sqlprotection": 1},
            "addons": {"bravo_tool": {"enabled": True}},
        }
    if "sql" not in settings or not isinstance(settings["sql"], dict):
        settings["sql"] = {"maxRows": 1000, "timeoutSeconds": 30, "sqlprotection": 1}
    elif "sqlprotection" not in settings["sql"]:
        settings["sql"]["sqlprotection"] = 1
    if "editor" not in settings or not isinstance(settings["editor"], dict):
        settings["editor"] = {
            "fontFamily": "Consolas",
            "fontSize": 14,
            "lineHeight": 0,
            "letterSpacing": 0,
            "tabSize": 4,
            "insertSpaces": True,
            "wordWrap": False,
            "minimap": True,
            "keywordCase": "upper",
        }
    else:
        if "lineHeight" not in settings["editor"]:
            settings["editor"]["lineHeight"] = 0
        if "letterSpacing" not in settings["editor"]:
            settings["editor"]["letterSpacing"] = 0
    cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
    settings["theme"] = cur_theme
    if "appearance" not in settings or not isinstance(settings["appearance"], dict):
        settings["appearance"] = {"theme": cur_theme, "iconSize": 16}
    else:
        settings["appearance"]["theme"] = cur_theme
    if "addons" not in settings or not isinstance(settings["addons"], dict):
        settings["addons"] = {"bravo_tool": {"enabled": True}}
    elif "bravo_tool" not in settings["addons"] or not isinstance(settings["addons"]["bravo_tool"], dict):
        settings["addons"]["bravo_tool"] = {"enabled": True}
    elif "enabled" not in settings["addons"]["bravo_tool"]:
        settings["addons"]["bravo_tool"]["enabled"] = True
    if "session" not in settings or not isinstance(settings["session"], dict):
        settings["session"] = {
            "restoreOnStartup": True,
            "saveSqlContent": True,
            "maxTabSizeBytes": 1048576,
            "autoSaveIntervalSeconds": 3
        }
    else:
        if "restoreOnStartup" not in settings["session"]:
            settings["session"]["restoreOnStartup"] = True
        if "saveSqlContent" not in settings["session"]:
            settings["session"]["saveSqlContent"] = True
        if "maxTabSizeBytes" not in settings["session"]:
            settings["session"]["maxTabSizeBytes"] = 1048576
        if "autoSaveIntervalSeconds" not in settings["session"]:
            settings["session"]["autoSaveIntervalSeconds"] = 3
    if "updates" not in settings or not isinstance(settings["updates"], dict):
        settings["updates"] = {
            "checkOnStartup": True,
            "updateUrl": "",
        }
    else:
        if "checkOnStartup" not in settings["updates"]:
            settings["updates"]["checkOnStartup"] = True
        if "updateUrl" not in settings["updates"]:
            settings["updates"]["updateUrl"] = ""
    if "syntax" not in settings or not isinstance(settings["syntax"], dict):
        settings["syntax"] = {
            "pipeline": True,
            "shadow": False,
        }
    else:
        if "pipeline" not in settings["syntax"]:
            settings["syntax"]["pipeline"] = True
        if "shadow" not in settings["syntax"]:
            settings["syntax"]["shadow"] = False
    return settings


load_settings = load_settings_file


def save_settings_file(settings: Dict[str, Any]) -> bool:
    """Save IDE settings to primary user data directory and alt location if exists."""
    if isinstance(settings, dict):
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        settings["theme"] = cur_theme
        if "appearance" not in settings or not isinstance(settings["appearance"], dict):
            settings["appearance"] = {"theme": cur_theme, "iconSize": 16}
        else:
            settings["appearance"]["theme"] = cur_theme
    ok1 = write_json(SETTINGS_FILE, settings)
    if SETTINGS_FILE_ALT.parent.exists():
        write_json(SETTINGS_FILE_ALT, settings)
    return ok1


def load_snippets_file() -> List[Dict[str, Any]]:
    """Load snippets list from user data, bundled static data, or Redgate directory."""
    if SNIPPETS_FILE.exists():
        data = read_json(SNIPPETS_FILE, None)
        if isinstance(data, list):
            return data
    alt_file = BUNDLE_DIR / "static" / "data" / "snippets.json"
    if alt_file.exists():
        data = read_json(alt_file, None)
        if isinstance(data, list):
            return data
    return import_redgate_snippets()


def save_snippets_file(snippets: List[Dict[str, Any]]) -> bool:
    """Persist snippets to user data and static bundle data."""
    if not isinstance(snippets, list):
        return False
    ok = write_json(SNIPPETS_FILE, snippets)
    alt_file = BUNDLE_DIR / "static" / "data" / "snippets.json"
    write_json(alt_file, snippets)
    return ok


def import_redgate_snippets() -> List[Dict[str, Any]]:
    """Scan and import snippets from configured Redgate SQL prompt snippets directory."""
    snippets = []
    redgate_dir = get_redgate_snippets_dir()
    if redgate_dir and redgate_dir.exists():
        for fp in redgate_dir.glob("*.json"):
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    snippets.append(json.load(f))
            except Exception as e:
                print(f"[Snippets] Read error {fp}: {e}")
    snippets.sort(key=lambda s: s.get("prefix", "").lower())
    save_snippets_file(snippets)
    return snippets


def get_saved_connections(filter_groups: bool = False) -> List[Dict[str, Any]]:
    """Load saved connection profiles with password masked and has_password boolean flag."""
    raw = read_json(CONNECTIONS_FILE, [])
    saved = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            d = dict(item)
            db_type = (d.get("type") or "").strip().lower()
            if filter_groups and (db_type == "group_marker" or str(d.get("name", "")).startswith("__group__")):
                continue
            if d.get("password"):
                d["has_password"] = True
                d.pop("password", None)
            else:
                d["has_password"] = False
            saved.append(d)
    return saved


# Aliases for backward compatibility
_read_json = read_json
_write_json = write_json
_get_redgate_snippets_dir = get_redgate_snippets_dir
_load_settings_file = load_settings_file
_save_settings_file = save_settings_file
_load_snippets_file = load_snippets_file
_save_snippets_file = save_snippets_file
_import_redgate_snippets = import_redgate_snippets

