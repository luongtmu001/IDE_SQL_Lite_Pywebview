# -*- coding: utf-8 -*-
"""
Application Update Checker Service.
Checks remote version.json (GitHub Releases or custom internal URL)
and compares semantic versioning in a non-blocking background thread.
"""
import json
import logging
import os
import sys
import threading
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from app.version import (
    __version__,
    __version_url__,
    __release_url__,
    compare_versions,
    parse_semver,
    get_version,
    set_runtime_version,
)

logger = logging.getLogger("luobtool.update_checker")

# In-memory cache for latest check result
_latest_check_result: Optional[Dict[str, Any]] = None
_check_lock = threading.Lock()
_bg_thread_started = False


def _get_settings_dict() -> Dict[str, Any]:
    """Retrieve settings dictionary with fallback if settings_store is not available."""
    try:
        from app.services.settings_store import load_settings_file
        return load_settings_file()
    except Exception:
        pass
    try:
        from app.utils.paths import get_user_data_dir
        user_settings = get_user_data_dir() / "settings.json"
        if user_settings.exists():
            with open(user_settings, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    try:
        from pathlib import Path
        for cand in [Path("data/settings.json"), Path("settings.json")]:
            if cand.exists():
                with open(cand, "r", encoding="utf-8") as f:
                    return json.load(f)
    except Exception:
        pass
    return {}


def _get_configured_update_url() -> str:
    """Retrieve update URL from settings or return default GitHub URL."""
    try:
        settings = _get_settings_dict()
        custom_url = settings.get("updates", {}).get("updateUrl", "")
        if custom_url and isinstance(custom_url, str) and custom_url.strip():
            return custom_url.strip()
    except Exception as exc:
        logger.debug("[UpdateChecker] Could not read settings: %s", exc)
    return __version_url__


def _is_check_on_startup_enabled() -> bool:
    """Check if automatic update check on startup is enabled in settings."""
    try:
        settings = _get_settings_dict()
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
        current_ver = get_version()
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

        # Support local file:// URLs or direct file paths for custom_url
        is_local_file = False
        local_file_path = None
        if url.startswith("file://"):
            clean_url = urllib.parse.unquote(url[7:])
            if os.name == "nt" and clean_url.startswith("/") and len(clean_url) > 2 and clean_url[2] == ":":
                clean_url = clean_url[1:]
            cand_p = Path(clean_url)
            if cand_p.exists():
                local_file_path = cand_p
                is_local_file = True
        elif not (url.startswith("http://") or url.startswith("https://")):
            cand_p = Path(url)
            if cand_p.exists():
                local_file_path = cand_p
                is_local_file = True

        if is_local_file and local_file_path:
            try:
                with open(local_file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                remote_ver = str(data.get("version", "")).strip()
                if remote_ver:
                    result["latestVersion"] = remote_ver
                    result["releaseDate"] = str(data.get("releaseDate", ""))
                    result["downloadUrl"] = str(data.get("downloadUrl", __release_url__))
                    result["releaseNotes"] = str(data.get("releaseNotes", ""))
                    result["highlights"] = list(data.get("highlights", []))
                    result["fileName"] = str(data.get("fileName", f"LLTool_v{remote_ver}.zip"))
                    try:
                        result["fileSize"] = int(data.get("fileSize", 0))
                    except Exception:
                        result["fileSize"] = 0
                    result["success"] = True
                    result["hasUpdate"] = compare_versions(remote_ver, current_ver) > 0
                    result["error"] = None
                else:
                    result["error"] = "Invalid local manifest: missing 'version' field."
            except Exception as read_err:
                result["error"] = f"Lỗi đọc file cấu hình cập nhật cục bộ: {read_err}"
        else:
            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": f"luoBTool-IDE/{current_ver} (Desktop Native)",
                        "Accept": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    status_code = getattr(resp, "status", 200)
                    if status_code in (200, None):
                        raw_data = resp.read().decode("utf-8")
                        data = json.loads(raw_data)

                        remote_ver = str(data.get("version", "")).strip()
                        if remote_ver:
                            result["latestVersion"] = remote_ver
                            result["releaseDate"] = str(data.get("releaseDate", ""))
                            result["downloadUrl"] = str(data.get("downloadUrl", __release_url__))
                            result["releaseNotes"] = str(data.get("releaseNotes", ""))
                            result["highlights"] = list(data.get("highlights", []))
                            result["fileName"] = str(data.get("fileName", ""))
                            try:
                                result["fileSize"] = int(data.get("fileSize", 0))
                            except Exception:
                                result["fileSize"] = 0
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

            except urllib.error.HTTPError as http_err:
                if http_err.code == 404:
                    # 404 indicates remote version file/release is not yet published on server.
                    # Current local build is up-to-date.
                    result["success"] = True
                    result["hasUpdate"] = False
                    result["isUpToDate"] = True
                    result["latestVersion"] = current_ver
                    result["message"] = f"Bạn đang sử dụng phiên bản mới nhất (v{current_ver}). Máy chủ phát hành chưa có bản cập nhật mới."
                    logger.info(
                        "[UpdateChecker] Remote version.json returned 404. Current version %s is latest.",
                        current_ver,
                    )
                else:
                    result["error"] = f"HTTP {http_err.code}: {http_err.reason}"
                    logger.debug("[UpdateChecker] HTTP error %s checking updates: %s", http_err.code, http_err)
            except urllib.error.URLError as url_err:
                result["error"] = f"Lỗi kết nối mạng: Không thể kết nối tới máy chủ cập nhật ({url_err.reason})"
                logger.debug("[UpdateChecker] Network check failed: %s", url_err)
            except TimeoutError:
                result["error"] = f"Hết thời gian chờ kết nối (Timeout sau {timeout}s)"
                logger.debug("[UpdateChecker] Check timed out")
            except json.JSONDecodeError as json_err:
                result["error"] = f"Phản hồi không hợp lệ từ máy chủ: {json_err}"
                logger.debug("[UpdateChecker] JSON parse error: %s", json_err)
            except Exception as exc:
                result["error"] = str(exc)
                logger.warning("[UpdateChecker] Unexpected error: %s", exc)

        # Fallback check for local version.json candidates:
        # If no update found yet (e.g. remote GitHub repository not yet pushed, or offline/staging):
        # Scan candidate local version.json files so users and developers can test and preview
        # new releases on both dev and packaged builds.
        if not custom_url and not result.get("hasUpdate"):
            try:
                from app.utils.paths import get_app_dir, get_user_data_dir
                app_dir = get_app_dir()
                user_data_dir = get_user_data_dir()
                candidates = [
                    user_data_dir / "version.json",
                    app_dir / "version.json",
                    app_dir / "_internal" / "version.json",
                    app_dir.parent / "version.json",
                    app_dir.parent.parent / "version.json",
                    Path.cwd() / "version.json",
                ]
                seen_paths = set()
                best_data = None
                best_ver = current_ver

                for cand in candidates:
                    try:
                        r_cand = cand.resolve()
                        if r_cand in seen_paths:
                            continue
                        seen_paths.add(r_cand)
                        if r_cand.exists() and r_cand.is_file():
                            with open(r_cand, "r", encoding="utf-8") as f:
                                l_data = json.load(f)
                            l_ver = str(l_data.get("version", "")).strip()
                            if l_ver and compare_versions(l_ver, best_ver) > 0:
                                best_ver = l_ver
                                best_data = l_data
                    except Exception:
                        continue

                if best_data and compare_versions(best_ver, current_ver) > 0:
                    result["success"] = True
                    result["hasUpdate"] = True
                    result["latestVersion"] = best_ver
                    result["releaseDate"] = str(best_data.get("releaseDate", ""))
                    result["downloadUrl"] = str(best_data.get("downloadUrl", __release_url__))
                    result["releaseNotes"] = str(best_data.get("releaseNotes", ""))
                    result["highlights"] = list(best_data.get("highlights", []))
                    result["fileName"] = str(best_data.get("fileName", f"LLTool_v{best_ver}.zip"))
                    try:
                        result["fileSize"] = int(best_data.get("fileSize", 0))
                    except Exception:
                        result["fileSize"] = 0
                    result["error"] = None
            except Exception as fallback_err:
                logger.debug("[UpdateChecker] Local fallback scan warning: %s", fallback_err)

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


# ── In-App Update Downloader & Progress Tracking ────────────────────────

import os
import subprocess
from pathlib import Path

_download_state: Dict[str, Any] = {
    "status": "idle",       # "idle" | "downloading" | "completed" | "error" | "cancelled"
    "progress": 0.0,
    "downloadedBytes": 0,
    "totalBytes": 0,
    "speed": "",
    "savedPath": "",
    "fileName": "",
    "error": None,
}
_download_lock = threading.Lock()
_cancel_download_event = threading.Event()
_download_thread: Optional[threading.Thread] = None


def get_default_download_dir() -> Path:
    """Return user's standard Downloads folder."""
    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        dl = Path(user_profile) / "Downloads"
        if dl.exists():
            return dl
    try:
        home_dl = Path.home() / "Downloads"
        if home_dl.exists():
            return home_dl
    except Exception:
        pass
    import tempfile
    return Path(tempfile.gettempdir())


def get_download_progress() -> Dict[str, Any]:
    """Retrieve thread-safe snapshot of download progress."""
    with _download_lock:
        return dict(_download_state)


def cancel_download() -> Dict[str, Any]:
    """Cancel ongoing download if active."""
    global _download_state
    _cancel_download_event.set()
    with _download_lock:
        if _download_state["status"] == "downloading":
            _download_state["status"] = "cancelled"
            _download_state["error"] = "Đã huỷ tải xuống."
    return {"success": True, "status": "cancelled"}


def start_download_update(
    download_url: Optional[str] = None,
    file_name: Optional[str] = None,
    target_dir: Optional[str] = None,
    total_bytes_hint: int = 0,
) -> Dict[str, Any]:
    """
    Start downloading update package in background daemon thread.
    Non-blocking. UI polls get_download_progress() for percentage updates.
    """
    global _download_state, _download_thread

    with _download_lock:
        if _download_state["status"] == "downloading":
            return {
                "success": False,
                "error": "Đang có tiến trình tải cập nhật khác đang chạy.",
                "data": dict(_download_state),
            }

        # Resolve URL
        url = download_url
        if not url:
            with _check_lock:
                if _latest_check_result and _latest_check_result.get("downloadUrl"):
                    url = _latest_check_result.get("downloadUrl")
        if not url:
            url = __release_url__

        # Resolve target directory
        save_dir = Path(target_dir) if target_dir else get_default_download_dir()
        try:
            save_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

        # Resolve filename
        if not file_name:
            with _check_lock:
                if _latest_check_result and _latest_check_result.get("fileName"):
                    file_name = _latest_check_result.get("fileName")
        if not file_name:
            raw_name = url.split("?")[0].rstrip("/").split("/")[-1]
            if raw_name and ("." in raw_name) and not raw_name.endswith(".html"):
                file_name = raw_name
            else:
                latest_ver = "latest"
                with _check_lock:
                    if _latest_check_result and _latest_check_result.get("latestVersion"):
                        latest_ver = _latest_check_result.get("latestVersion")
                file_name = f"LLTool_v{latest_ver}.zip"

        dest_file = save_dir / file_name

        _cancel_download_event.clear()
        _download_state = {
            "status": "downloading",
            "progress": 0.0,
            "downloadedBytes": 0,
            "totalBytes": total_bytes_hint,
            "speed": "0 KB/s",
            "savedPath": str(dest_file),
            "fileName": file_name,
            "error": None,
        }

    def _worker():
        global _download_state
        temp_file = dest_file.with_name(dest_file.name + ".part")
        start_time = time.time()
        last_calc_time = start_time
        last_calc_bytes = 0

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": f"luoBTool-IDE/{__version__} (UpdateDownloader; Windows)",
                    "Accept": "*/*",
                },
            )
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                try:
                    status_code = int(getattr(resp, "status", 200))
                except Exception:
                    status_code = 200
                if status_code >= 400:
                    raise Exception(f"Máy chủ phản hồi mã lỗi {status_code}")

                # Check Content-Length header
                content_len_header = resp.headers.get("Content-Length")
                total_len = 0
                if content_len_header and content_len_header.isdigit():
                    total_len = int(content_len_header)
                if total_len == 0 and total_bytes_hint > 0:
                    total_len = total_bytes_hint

                with _download_lock:
                    if total_len > 0:
                        _download_state["totalBytes"] = total_len

                downloaded = 0
                chunk_size = 64 * 1024  # 64 KB

                with open(temp_file, "wb") as out_fp:
                    while True:
                        if _cancel_download_event.is_set():
                            raise Exception("Tải xuống đã bị huỷ bởi người dùng.")

                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break

                        out_fp.write(chunk)
                        downloaded += len(chunk)

                        now = time.time()
                        dt = now - last_calc_time
                        speed_str = ""
                        if dt >= 0.3:
                            speed_bps = (downloaded - last_calc_bytes) / dt
                            last_calc_time = now
                            last_calc_bytes = downloaded
                            if speed_bps >= 1024 * 1024:
                                speed_str = f"{speed_bps / (1024 * 1024):.1f} MB/s"
                            else:
                                speed_str = f"{speed_bps / 1024:.0f} KB/s"

                        pct = 0.0
                        if total_len > 0:
                            pct = min(99.9, (downloaded / total_len) * 100.0)
                        else:
                            pct = min(95.0, (downloaded / (downloaded + 1024 * 1024)) * 100.0)

                        with _download_lock:
                            _download_state["downloadedBytes"] = downloaded
                            _download_state["progress"] = pct
                            if speed_str:
                                _download_state["speed"] = speed_str

            # Finish download atomically
            if temp_file.exists():
                if dest_file.exists():
                    try:
                        dest_file.unlink()
                    except Exception:
                        pass
                temp_file.replace(dest_file)

            with _download_lock:
                _download_state["status"] = "completed"
                _download_state["progress"] = 100.0
                _download_state["downloadedBytes"] = downloaded
                _download_state["totalBytes"] = downloaded
                _download_state["speed"] = "Hoàn tất"
                _download_state["savedPath"] = str(dest_file)
                _download_state["error"] = None

        except Exception as exc:
            logger.warning("[UpdateDownloader] Download failed: %s", exc)
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass
            with _download_lock:
                _download_state["status"] = "error"
                _download_state["error"] = str(exc)

    _download_thread = threading.Thread(target=_worker, name="UpdateDownloadWorker", daemon=True)
    _download_thread.start()

    return {
        "success": True,
        "status": "downloading",
        "data": dict(_download_state),
    }


def apply_update(file_path: Optional[str] = None, new_version: Optional[str] = None) -> Dict[str, Any]:
    """
    Apply downloaded update:
    1. Determine target version from argument, check result, or filename.
    2. Persist new version to settings.json and local version.json files.
    3. Update runtime version and in-memory update check status to up-to-date.
    4. If downloaded file is an executable/installer (.exe / .msi), run it.
    """
    global _latest_check_result, _download_state

    target_ver = new_version
    if not target_ver:
        with _check_lock:
            if _latest_check_result and _latest_check_result.get("latestVersion"):
                target_ver = _latest_check_result.get("latestVersion")
    if not target_ver:
        with _download_lock:
            fn = _download_state.get("fileName", "")
            import re
            m = re.search(r"v?(\d+\.\d+\.\d+)", fn)
            if m:
                target_ver = m.group(1)
    if not target_ver:
        target_ver = get_version()

    target_ver = str(target_ver).strip().lstrip("vV")

    # Set in-memory runtime version immediately
    set_runtime_version(target_ver)

    with _check_lock:
        if _latest_check_result is None:
            _latest_check_result = {}
        _latest_check_result["hasUpdate"] = False
        _latest_check_result["currentVersion"] = target_ver
        _latest_check_result["latestVersion"] = target_ver
        _latest_check_result["isUpToDate"] = True

    # Persist to settings.json
    try:
        from app.services.settings_store import load_settings_file, save_settings_file
        settings = load_settings_file()
        if not isinstance(settings, dict):
            settings = {}
        if "updates" not in settings or not isinstance(settings["updates"], dict):
            settings["updates"] = {}
        settings["updates"]["installedVersion"] = target_ver
        settings["updates"]["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        settings["installedVersion"] = target_ver
        save_settings_file(settings)
    except Exception as exc:
        logger.warning("[UpdateChecker] Could not persist to settings.json: %s", exc)

    # Persist to version.json files
    try:
        from app.utils.paths import get_app_dir, get_user_data_dir
        app_d = get_app_dir()
        user_d = get_user_data_dir()
        for p in [
            app_d / "version.json",
            app_d / "_internal" / "version.json",
            user_d / "version.json",
        ]:
            if p.exists():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    data["version"] = target_ver
                    with open(p, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass
    except Exception as exc:
        logger.warning("[UpdateChecker] Could not persist to version.json: %s", exc)

    return {
        "success": True,
        "version": target_ver,
        "message": f"Đã áp dụng cập nhật phiên bản v{target_ver} thành công.",
    }


def open_downloaded_file(file_path: Optional[str] = None) -> Dict[str, Any]:
    """Apply version update and launch installer or reveal downloaded update archive."""
    # Always apply update persistence first
    apply_res = apply_update(file_path=file_path)

    target = file_path
    if not target:
        with _download_lock:
            target = _download_state.get("savedPath")

    if target and os.path.exists(target):
        ext = os.path.splitext(target)[1].lower()
        if ext in [".exe", ".msi"]:
            try:
                os.startfile(target)
            except Exception as exc:
                logger.warning("[UpdateChecker] Failed to launch installer: %s", exc)
        else:
            try:
                os.startfile(target)
            except Exception:
                pass

    return apply_res


def open_containing_folder(file_path: Optional[str] = None) -> Dict[str, Any]:
    """Reveal downloaded file in Windows Explorer."""
    target = file_path
    if not target:
        with _download_lock:
            target = _download_state.get("savedPath")
    if not target or not os.path.exists(target):
        dl = get_default_download_dir()
        if dl.exists():
            os.startfile(str(dl))
            return {"success": True, "path": str(dl)}
        return {"success": False, "error": f"Không tìm thấy đường dẫn: {target}"}

    try:
        subprocess.Popen(f'explorer /select,"{os.path.abspath(target)}"', shell=True)
        return {"success": True, "path": target}
    except Exception as exc:
        return {"success": False, "error": str(exc)}

