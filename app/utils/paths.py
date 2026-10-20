# -*- coding: utf-8 -*-
"""
Central path resolution and user data directory management.
Separates application code/installation from user data and credentials.
"""
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger("app.utils.paths")


def get_app_dir() -> Path:
    """Return the application installation or source directory."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # When running from source, project root is two levels up from app/utils
    return Path(__file__).resolve().parent.parent.parent


def get_bundle_dir() -> Path:
    """Return the resource bundle directory (supports PyInstaller _MEIPASS and development mode)."""
    app_dir = get_app_dir()
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass and (Path(meipass) / "templates").exists():
            return Path(meipass).resolve()
        elif (app_dir / "_internal" / "templates").exists():
            return app_dir / "_internal"
        elif (app_dir / "templates").exists():
            return app_dir
        else:
            return app_dir
    return app_dir


PORTABLE_FLAGS = ("portable.flag", "portable.txt", ".portable")


def is_portable_mode(app_dir: Optional[Path] = None) -> bool:
    """
    Check if portable mode is enabled.
    Returns True if any portable flag file (portable.flag, portable.txt, .portable)
    exists in the application installation or source directory.
    """
    base_dir = app_dir or get_app_dir()
    for flag_name in PORTABLE_FLAGS:
        flag_path = base_dir / flag_name
        if flag_path.exists():
            return True
    return False


def set_portable_mode(enable: bool, app_dir: Optional[Path] = None) -> bool:
    """
    Enable or disable portable mode by creating or removing the portable.flag file.
    """
    base_dir = app_dir or get_app_dir()
    primary_flag = base_dir / "portable.flag"
    try:
        if enable:
            primary_flag.write_text("portable=true\n", encoding="utf-8")
            (base_dir / "data").mkdir(parents=True, exist_ok=True)
            logger.info("[Paths] Portable mode enabled at %s", primary_flag)
        else:
            for flag_name in PORTABLE_FLAGS:
                f = base_dir / flag_name
                if f.exists():
                    f.unlink()
            logger.info("[Paths] Portable mode disabled")
        return True
    except Exception as exc:
        logger.warning("[Paths] Failed to change portable mode (%s): %s", enable, exc)
        return False


def get_user_data_dir() -> Path:
    """
    Return the user data directory.
    Priority 1: Environment override via LLTOOL_DATA_DIR (testing / scripts).
    Priority 2: Portable mode flag (portable.flag adjacent to app executable) -> <app_dir>/data.
    Priority 3: Default %APPDATA%\\LLTool (Windows) or ~/.local/share/LLTool (fallback/non-windows).
    """
    env_dir = os.environ.get("LLTOOL_DATA_DIR")
    if env_dir:
        path = Path(env_dir).resolve()
    elif is_portable_mode():
        path = (get_app_dir() / "data").resolve()
    else:
        appdata = os.environ.get("APPDATA")
        if appdata:
            path = Path(appdata) / "LLTool"
        else:
            path = Path.home() / ".local" / "share" / "LLTool"
    
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_data_dir_migrated(app_dir: Optional[Path] = None) -> Path:
    """
    Perform first-run migration:
    If user data directory has not been migrated yet and APP_DIR/data has files,
    copy them (without deleting originals) and mark migrated.
    """
    target_dir = get_user_data_dir()
    migration_flag = target_dir / ".migrated"
    source_dir = (app_dir or get_app_dir()) / "data"

    if source_dir.resolve() == target_dir.resolve():
        try:
            if not migration_flag.exists():
                migration_flag.write_text("migrated=portable\n", encoding="utf-8")
        except Exception:
            pass
        return target_dir

    if source_dir.exists() and source_dir.is_dir():
        try:
            for item in source_dir.iterdir():
                if item.name.startswith(".webview_cache") or item.name == "logs":
                    continue
                target_item = target_dir / item.name
                if not target_item.exists():
                    if item.is_file():
                        shutil.copy2(item, target_item)
                        logger.info("[Paths] Migrated/Copied missing file: %s", item.name)
                    elif item.is_dir():
                        shutil.copytree(item, target_item)
                        logger.info("[Paths] Migrated/Copied missing directory: %s", item.name)
        except Exception as exc:
            logger.warning("[Paths] Migration encountered error: %s", exc)

    if not migration_flag.exists():
        try:
            migration_flag.write_text("migrated=true\n", encoding="utf-8")
        except Exception as exc:
            logger.warning("[Paths] Could not write migration flag: %s", exc)

    return target_dir
