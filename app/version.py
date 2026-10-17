# -*- coding: utf-8 -*-
"""
Central version and build metadata for luoBTool IDE / LLTool Desktop.
Single Source of Truth for application versioning, build information, and release endpoints.
"""
import sys
from typing import Any, Dict, Tuple


__version__ = "1.0.1"
__version_tuple__: Tuple[int, int, int] = (1, 0, 1)
__app_name__ = "luoBTool IDE"
__app_title__ = "luoBTool IDE / LLTool Desktop"
__author__ = "luonght"
__description__ = "Modern Database IDE & Developer Suite with High-Performance Schema Compare"
__github_repo__ = "luongtmu001/IDE_SQL_Lite_Pywebview"
__release_url__ = "https://github.com/luongtmu001/IDE_SQL_Lite_Pywebview/releases"
__version_url__ = "https://raw.githubusercontent.com/luongtmu001/IDE_SQL_Lite_Pywebview/main/version.json"

_runtime_version: Any = None


def set_runtime_version(new_version: str) -> None:
    """Set the active version string in runtime memory."""
    global _runtime_version
    if new_version:
        _runtime_version = str(new_version).strip()


def get_version() -> str:
    """
    Return the current version string.
    Checks in order:
    1. Active runtime version (if updated in current session)
    2. User settings (installedVersion)
    3. Local version.json
    4. Static build version (__version__)
    """
    global _runtime_version
    if _runtime_version:
        return _runtime_version

    try:
        import json
        from pathlib import Path

        # 1. Check user data settings
        try:
            from app.utils.paths import get_user_data_dir, get_app_dir
            user_settings = get_user_data_dir() / "settings.json"
            if user_settings.exists():
                with open(user_settings, "r", encoding="utf-8") as f:
                    s = json.load(f)
                    inst_ver = s.get("updates", {}).get("installedVersion") or s.get("installedVersion")
                    if inst_ver:
                        _runtime_version = str(inst_ver).strip()
                        return _runtime_version
        except Exception:
            pass

        # 2. Check candidate version.json files
        candidates = []
        try:
            candidates.append(get_app_dir() / "version.json")
            candidates.append(get_app_dir() / "_internal" / "version.json")
        except Exception:
            pass

        for cand in candidates:
            if cand.exists():
                with open(cand, "r", encoding="utf-8") as f:
                    v_data = json.load(f)
                    if v_data.get("version"):
                        _runtime_version = str(v_data["version"]).strip()
                        return _runtime_version
    except Exception:
        pass

    return __version__



def parse_semver(version_str: str) -> Tuple[int, ...]:
    """
    Parse a semantic version string (e.g. '1.0.0', 'v1.2.3', '2.1.0-beta')
    into a comparable tuple of integers.
    """
    if not version_str or not isinstance(version_str, str):
        return (0, 0, 0)
    cleaned = version_str.strip().lstrip("vV")
    # Separate pre-release or build metadata (e.g. -beta, +build)
    base = cleaned.split("-")[0].split("+")[0]
    parts = []
    for part in base.split("."):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def compare_versions(v1: str, v2: str) -> int:
    """
    Compare two semver strings.
    Returns:
       1 if v1 > v2 (v1 is newer)
       0 if v1 == v2
      -1 if v1 < v2 (v2 is newer)
    """
    t1 = parse_semver(v1)
    t2 = parse_semver(v2)
    if t1 > t2:
        return 1
    elif t1 < t2:
        return -1
    return 0


def get_app_info() -> Dict[str, Any]:
    """Return comprehensive application and runtime information."""
    from app.utils.paths import get_app_dir, get_user_data_dir, is_portable_mode

    return {
        "appName": __app_name__,
        "appTitle": __app_title__,
        "version": get_version(),
        "author": __author__,
        "description": __description__,
        "isPortable": is_portable_mode(),
        "appDir": str(get_app_dir()),
        "userDataDir": str(get_user_data_dir()),
        "releaseUrl": __release_url__,
        "updateUrl": __version_url__,
        "pythonVersion": sys.version.split()[0],
        "platform": sys.platform,
        "isFrozen": getattr(sys, "frozen", False),
    }
