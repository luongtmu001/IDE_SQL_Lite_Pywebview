# -*- coding: utf-8 -*-
"""
Application Update Checker Service.
Checks remote version.json (GitHub Releases or custom internal URL)
and compares semantic versioning in a non-blocking background thread.
"""
import json
import logging
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from app.version import (
    __version__,
    __version_url__,
    __release_url__,
    compare_versions,
    parse_semver,
)

logger = logging.getLogger("luobtool.update_checker")

# In-memory cache for latest check result
_latest_check_result: Optional[Dict[str, Any]] = None
_check_lock = threading.Lock()
_bg_thread_started = False


def _get_configured_update_url() -> str:
    """Retrieve update URL from settings or return default GitHub URL."""
    try:
        from app.services.settings_store import load_settings_file

        settings = load_settings_file()
        custom_url = settings.get("updates", {}).get("updateUrl", "")
        if custom_url and isinstance(custom_url, str) and custom_url.strip():
            return custom_url.strip()
    except Exception as exc:
        logger.debug("[UpdateChecker] Could not read settings: %s", exc)
    return __version_url__


def _is_check_on_startup_enabled() -> bool:
    """Check if automatic update check on startup is enabled in settings."""
    try:
        from app.services.settings_store import load_settings_file

        settings = load_settings_file()
        return bool(settings.get("updates", {}).get("checkOnStartup", True))
    except Exception:
        return True


def check_for_updates(
    force: bool = False,
    custom_url: Optional[str] = None,
    timeout: float = 4.0,
) -> Dict[str, Any]:
    """
    Perform a version check against remote version.json.
    Non-destructive and strictly read-only.
    Returns dictionary with update details.
    """
    global _latest_check_result

    with _check_lock:
        if not force and _latest_check_result is not None:
            return _latest_check_result

        url = custom_url or _get_configured_update_url()
        current_ver = __version__
        now_iso = datetime.now(timezone.utc).isoformat()

        result = {
            "success": False,
            "hasUpdate": False,
            "currentVersion": current_ver,
            "latestVersion": current_ver,
            "releaseDate": "",
            "downloadUrl": __release_url__,
            "releaseNotes": "",
            "highlights": [],
            "checkedAt": now_iso,
            "url": url,
            "error": None,
        }

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": f"luoBTool-IDE/{current_ver} (Desktop Native)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    raw_data = resp.read().decode("utf-8")
                    data = json.loads(raw_data)

                    remote_ver = str(data.get("version", "")).strip()
                    if remote_ver:
                        result["latestVersion"] = remote_ver
                        result["releaseDate"] = str(data.get("releaseDate", ""))
                        result["downloadUrl"] = str(data.get("downloadUrl", __release_url__))
                        result["releaseNotes"] = str(data.get("releaseNotes", ""))
                        result["highlights"] = list(data.get("highlights", []))
                        result["success"] = True

                        # Compare versions (remote > current)
                        cmp = compare_versions(remote_ver, current_ver)
                        if cmp > 0:
                            result["hasUpdate"] = True
                            logger.info(
                                "[UpdateChecker] Newer version available: %s (current: %s)",
                                remote_ver,
                                current_ver,
                            )
                        else:
                            result["hasUpdate"] = False
                            logger.debug(
                                "[UpdateChecker] Application is up-to-date (version: %s)",
                                current_ver,
                            )
                    else:
                        result["error"] = "Invalid remote payload: missing 'version' field."
                else:
                    result["error"] = f"HTTP error {resp.status}"

        except urllib.error.URLError as url_err:
            result["error"] = f"Network error: {url_err.reason}"
            logger.debug("[UpdateChecker] Network check failed: %s", url_err)
        except TimeoutError:
            result["error"] = f"Connection timed out after {timeout}s"
            logger.debug("[UpdateChecker] Check timed out")
        except json.JSONDecodeError as json_err:
            result["error"] = f"Invalid JSON response: {json_err}"
            logger.debug("[UpdateChecker] JSON parse error: %s", json_err)
        except Exception as exc:
            result["error"] = str(exc)
            logger.warning("[UpdateChecker] Unexpected error: %s", exc)

        _latest_check_result = result
        return result


def get_cached_update_info() -> Optional[Dict[str, Any]]:
    """Return cached update check result if available."""
    with _check_lock:
        return _latest_check_result


def start_background_check(
    callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    delay: float = 3.0,
) -> None:
    """
    Launch background thread to check updates after initial startup delay.
    Guarantees zero blocking of main UI or Monaco loading.
    """
    global _bg_thread_started
    if _bg_thread_started:
        return
    _bg_thread_started = True

    def _worker():
        if not _is_check_on_startup_enabled():
            logger.debug("[UpdateChecker] Background check skipped (disabled in settings)")
            return

        time.sleep(delay)
        res = check_for_updates(force=True)
        if res.get("hasUpdate") and callback:
            try:
                callback(res)
            except Exception as cb_exc:
                logger.debug("[UpdateChecker] Callback exception: %s", cb_exc)

    thread = threading.Thread(target=_worker, name="UpdateCheckerThread", daemon=True)
    thread.start()
