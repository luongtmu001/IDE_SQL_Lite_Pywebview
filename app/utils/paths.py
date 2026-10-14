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


def get_user_data_dir() -> Path:
    """
    Return the user data directory.
    Default: %APPDATA%\\LLTool (Windows) or ~/.local/share/LLTool (fallback/non-windows).
    Can be overridden via LLTOOL_DATA_DIR environment variable.
    """
    env_dir = os.environ.get("LLTOOL_DATA_DIR")
    if env_dir:
        path = Path(env_dir).resolve()
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

    if migration_flag.exists():
        return target_dir

    source_dir = (app_dir or get_app_dir()) / "data"

    if source_dir.exists() and source_dir.is_dir():
        logger.info("[Paths] First-run migration: copying existing data from %s to %s", source_dir, target_dir)
        try:
            for item in source_dir.iterdir():
                if item.name.startswith(".webview_cache") or item.name == "logs":
                    continue
                target_item = target_dir / item.name
                if not target_item.exists():
                    if item.is_file():
                        shutil.copy2(item, target_item)
                        logger.info("[Paths] Migrated file: %s", item.name)
                    elif item.is_dir():
                        shutil.copytree(item, target_item)
                        logger.info("[Paths] Migrated directory: %s", item.name)
        except Exception as exc:
            logger.warning("[Paths] Migration encountered error: %s", exc)

    try:
        migration_flag.write_text("migrated=true\n", encoding="utf-8")
    except Exception as exc:
        logger.warning("[Paths] Could not write migration flag: %s", exc)

    return target_dir
