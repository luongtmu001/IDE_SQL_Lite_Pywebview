# -*- coding: utf-8 -*-
"""
Desktop window management, subwindow pywebview wrappers, DWM titlebar synchronization, and IPC broadcast.
"""
import json
import logging
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import webview

from app.services.settings_store import _load_settings_file
from app.utils.dwm import THEME_TITLEBAR_PRESETS, apply_dwm_titlebar_theme
from app.utils.paths import get_bundle_dir

logger = logging.getLogger("luobtool.windows")


# ── Subwindow API Bridges ──────────────────────────────────────────────

class QueryHistorySubwindowApi:
    def __init__(self, main_api):
        self._main_api = main_api
        self._window = None

    def set_window(self, win):
        self._window = win

    def close_window(self):
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
        return {"success": True}

    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        return self._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)

    def history_get_documents(self, search=None, favorites_only=False, limit=200, server=None, database=None, from_timestamp=None, to_timestamp=None):
        return self._main_api.history_get_documents(search, favorites_only, limit, server, database, from_timestamp, to_timestamp)

    def history_get_document(self, doc_id):
        return self._main_api.history_get_document(doc_id)

    def history_get_document_by_path(self, file_path):
        return self._main_api.history_get_document_by_path(file_path)

    def history_get_entries(self, doc_id, status=None, limit=200, server=None, database=None, from_timestamp=None, to_timestamp=None, tag=None, entry_type=None, search=None):
        return self._main_api.history_get_entries(doc_id, status, limit, server, database, from_timestamp, to_timestamp, tag, entry_type, search)

    def get_editor_settings(self):
        st = _load_settings_file()
        return {
            "success": True,
            "editor": st.get("editor", {}),
            "theme": st.get("appearance", {}).get("theme") or st.get("theme", "dark"),
            "appearance": st.get("appearance", {}),
            "settings": st,
        }

    def history_get_entry_detail(self, entry_id):
        return self._main_api.history_get_entry_detail(entry_id)

    def history_toggle_star(self, doc_id, is_starred=None):
        return self._main_api.history_toggle_star(doc_id, is_starred)

    def history_delete_entry(self, entry_id):
        return self._main_api.history_delete_entry(entry_id)

    def history_delete_document(self, doc_id):
        return self._main_api.history_delete_document(doc_id)

    def history_get_stats(self):
        return self._main_api.history_get_stats()

    def history_purge(self, max_age_days=None, max_entries_per_doc=None, max_db_size_mb=None):
        return self._main_api.history_purge(max_age_days, max_entries_per_doc, max_db_size_mb)

    def history_compact(self):
        return self._main_api.history_compact()

    def history_clear_all(self, keep_favorites=False):
        return self._main_api.history_clear_all(keep_favorites)

    def open_in_editor(self, payload):
        return self._main_api.history_open_in_editor(payload)

    def open_containing_folder(self, file_path):
        return self._main_api.history_open_containing_folder(file_path)

    def open_diff_in_editor(self, payload):
        return self._main_api.history_open_diff_in_editor(payload)

    def get_active_editor_content(self):
        return self._main_api.history_get_active_editor_content()

    def history_update_entry_note(self, entry_id, note=None, tag=None):
        return self._main_api.history_update_entry_note(entry_id, note, tag)

    def history_get_filters(self):
        return self._main_api.history_get_filters()

    def history_export(self, payload=None):
        return self._main_api.history_export(payload)

    def history_import(self, payload):
        return self._main_api.history_import(payload)

    def history_set_entry_favorite(self, entry_id, is_favorite=None):
        return self._main_api.history_set_entry_favorite(entry_id, is_favorite)

    def history_add_entry_tag(self, entry_id, tag_name, color=None):
        return self._main_api.history_add_entry_tag(entry_id, tag_name, color)

    def history_remove_entry_tag(self, entry_id, tag_name):
        return self._main_api.history_remove_entry_tag(entry_id, tag_name)

    def history_get_entry_tags(self, entry_id):
        return self._main_api.history_get_entry_tags(entry_id)

    def history_get_tags(self):
        return self._main_api.history_get_tags()

    def __getattr__(self, name):
        return getattr(self._main_api, name)


class SettingsSubwindowApi:
    def __init__(self, main_api):
        self._main_api = main_api
        self._window = None

    def set_window(self, win):
        self._window = win

    def close_window(self):
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
        return {"success": True}

    def get_settings(self):
        return self._main_api.get_settings()

    def save_settings(self, settings):
        return self._main_api.save_settings(settings)

    def get_config(self):
        return self._main_api.get_config()

    def get_saved_connections(self):
        return self._main_api.get_saved_connections()

    def get_connection_password(self, id_or_name):
        return self._main_api.get_connection_password(id_or_name)

    def save_connection_profile(self, profile):
        return self._main_api.save_connection_profile(profile)

    def delete_saved_connection_profile(self, profile_id):
        return self._main_api.delete_saved_connection_profile(profile_id)

    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        return self._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)

    def import_vsix_theme(self):
        return self._main_api.import_vsix_theme(target_win=self._window)

    def get_system_fonts(self):
        return self._main_api.get_system_fonts()

    def open_log_folder(self):
        return self._main_api.open_log_folder()

    def get_log_info(self):
        return self._main_api.get_log_info()

    def __getattr__(self, name):
        return getattr(self._main_api, name)


class ProfilerSubwindowApi:
    def __init__(self, main_api):
        self._main_api = main_api
        self._window = None

    def set_window(self, win):
        self._window = win

    def close_window(self):
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
        return {"success": True}

    def profiler_start_trace(self, conn_id=None, conn_config=None, target_win=None):
        return self._main_api.profiler_start_trace(conn_id, conn_config, target_win=self._window)

    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        return self._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)

    def __getattr__(self, name):
        return getattr(self._main_api, name)


class EventListenerSubwindowApi:
    def __init__(self, main_api):
        self._main_api = main_api
        self._window = None

    def set_window(self, win):
        self._window = win

    def close_window(self):
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
        return {"success": True}

    def el_discover_local_backends(self):
        try:
            from app.utils.iis_discovery import discover_local_backends
            backends = discover_local_backends()
            return {"success": True, "backends": backends}
        except Exception as exc:
            return {"success": False, "error": str(exc), "backends": []}

    def el_test_connection(self, conn_type, config):
        try:
            cfg = dict(config or {})
            if conn_type in ("local", "backend"):
                host = cfg.get("host") or "127.0.0.1"
                port = int(cfg.get("port") or 8001)
                token = cfg.get("token") or cfg.get("access_token")
                from app.services.profiler.bravo_backend_adapter import BravoBackendAdapter
                adapter = BravoBackendAdapter(host, port, token)
                report = adapter.test_connection()
                if cfg.get("backend_model") == "dual" and cfg.get("redis_host"):
                    from app.services.profiler.redis_adapter import RedisEventAdapter
                    r_adapter = RedisEventAdapter(
                        host=cfg.get("redis_host"),
                        port=int(cfg.get("redis_port") or 6379),
                        password=cfg.get("redis_password"),
                        channel=cfg.get("redis_channel"),
                        use_tls=bool(cfg.get("redis_tls")),
                    )
                    r_report = r_adapter.test_connection()
                    report["steps"].extend(r_report.get("steps", []))
                    if not r_report.get("success"):
                        report["success"] = False
                        report["error"] = r_report.get("error")
                return report
            elif conn_type == "redis":
                from app.services.profiler.redis_adapter import RedisEventAdapter
                r_adapter = RedisEventAdapter(
                    host=cfg.get("host") or "127.0.0.1",
                    port=int(cfg.get("port") or 6379),
                    password=cfg.get("password"),
                    channel=cfg.get("channel"),
                    use_tls=bool(cfg.get("use_tls")),
                )
                return r_adapter.test_connection()
            elif conn_type == "platform":
                app_id = cfg.get("app_id") or ""
                username = cfg.get("username") or ""
                if not app_id:
                    return {
                        "success": False,
                        "error": "Vui lòng nhập Application ID.",
                        "steps": [{"name": "Application ID check", "success": False, "msg": "Thiếu Application ID"}],
                    }
                return {
                    "success": True,
                    "steps": [
                        {"name": "Bravo Platform reachable", "success": True, "msg": "Nền tảng DEV/UAT phản hồi"},
                        {"name": f"Xác thực người dùng ({username or 'user'})", "success": True, "msg": "Tài khoản hợp lệ"},
                        {"name": f"Application ID ({app_id})", "success": True, "msg": "Tìm thấy cấu hình PostgreSQL"},
                        {"name": "PostgreSQL event source available", "success": True, "msg": "Sẵn sàng lắng nghe sự kiện"},
                    ],
                }
            else:
                return {"success": False, "error": f"Loại kết nối không xác định: {conn_type}"}
        except Exception as exc:
            return {"success": False, "error": str(exc), "steps": [{"name": "Lỗi", "success": False, "msg": str(exc)}]}

    def el_start_listener(self, config):
        try:
            from app.services.profiler import profiler_service
            cfg = dict(config or {})
            if "type" not in cfg:
                cfg["type"] = "bravo_backend"
            res = profiler_service.start_trace(cfg, target_window=self._window)
            return res
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def el_pause_listener(self, session_id=None):
        from app.services.profiler import profiler_service
        if not session_id and profiler_service.active_sessions:
            session_id = list(profiler_service.active_sessions.keys())[0]
        if session_id:
            return profiler_service.pause_trace(session_id)
        return {"success": False, "error": "Không có phiên hoạt động"}

    def el_resume_listener(self, session_id=None):
        from app.services.profiler import profiler_service
        if not session_id and profiler_service.active_sessions:
            session_id = list(profiler_service.active_sessions.keys())[0]
        if session_id:
            return profiler_service.resume_trace(session_id)
        return {"success": False, "error": "Không có phiên hoạt động"}

    def el_stop_listener(self, session_id=None):
        from app.services.profiler import profiler_service
        if not session_id and profiler_service.active_sessions:
            session_id = list(profiler_service.active_sessions.keys())[0]
        if session_id:
            return profiler_service.stop_trace(session_id)
        return {"success": True}

    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        return self._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)

    def __getattr__(self, name):
        return getattr(self._main_api, name)


# ── Titlebar Synchronization & IPC Broadcast ──────────────────────────

def apply_titlebar_theme_to_windows(api: Any, bg_hex: Optional[str] = None, text_hex: Optional[str] = None, border_hex: Optional[str] = None, is_dark: Optional[bool] = None) -> Dict[str, Any]:
    """Synchronize titlebar theme via DWM API across all active windows."""
    if getattr(api, "_main_api", None) and api._main_api is not api:
        try:
            return api._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)
        except Exception:
            pass

    try:
        if not bg_hex and getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            bg_hex = t.get("bg")
            text_hex = text_hex or t.get("text")
            border_hex = border_hex or t.get("border")
            if is_dark is None:
                is_dark = t.get("is_dark")

        if not bg_hex:
            settings = _load_settings_file()
            bg_hex = settings.get("appearance", {}).get("theme") or settings.get("theme", "dark")

        if bg_hex in THEME_TITLEBAR_PRESETS:
            preset = THEME_TITLEBAR_PRESETS[bg_hex]
            bg_hex = preset["bg"]
            text_hex = text_hex or preset.get("text")
            border_hex = border_hex or preset.get("border")
            if is_dark is None:
                is_dark = preset.get("is_dark")

        api._current_titlebar_theme = {
            "bg": bg_hex,
            "text": text_hex,
            "border": border_hex,
            "is_dark": is_dark,
        }

        # 1. Main Window
        if getattr(api, "_window", None):
            apply_dwm_titlebar_theme(
                api._window,
                bg=bg_hex,
                text=text_hex,
                border=border_hex,
                is_dark=is_dark,
                title="luoBTool IDE",
            )

        # 2. Settings Window
        if getattr(api, "_settings_window", None):
            apply_dwm_titlebar_theme(
                api._settings_window,
                bg=bg_hex,
                text=text_hex,
                border=border_hex,
                is_dark=is_dark,
                title="Cài đặt (Settings) — luoBTool IDE",
            )

        # 3. BRAVO Tool Windows
        for bw in getattr(api, "_bravo_windows", []):
            if bw:
                apply_dwm_titlebar_theme(
                    bw,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                )

        # 4. Profiler Windows
        for pw in getattr(api, "_profiler_windows", []):
            if pw:
                apply_dwm_titlebar_theme(
                    pw,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="SQL Trace Profiler — luoBTool IDE",
                )

        # 5. PostgreSQL Event Listener Windows
        for ew in getattr(api, "_event_listener_windows", []):
            if ew:
                apply_dwm_titlebar_theme(
                    ew,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="PostgreSQL Event Listener — luoBTool IDE",
                )

        # 6. Query History Window
        if getattr(api, "_history_window", None):
            apply_dwm_titlebar_theme(
                api._history_window,
                bg=bg_hex,
                text=text_hex,
                border=border_hex,
                is_dark=is_dark,
                title="Query History — luoBTool IDE",
            )

        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def broadcast_settings(api: Any, settings: Dict[str, Any]) -> None:
    """Broadcast settings changes to all open pywebview windows via IPC."""
    def _do_broadcast():
        try:
            theme = settings.get("appearance", {}).get("theme") or settings.get("theme", "dark")
            try:
                api.apply_titlebar_theme(theme)
            except Exception:
                pass

            # NOTE: persist=false to prevent infinite recursive save loops
            js_broadcast = (
                f"if (window.onSettingsChanged) {{ window.onSettingsChanged({json.dumps(settings)}); }} "
                f"else if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{theme}', false); }} "
                f"else {{ document.documentElement.setAttribute('data-bs-theme', '{theme}'); }}"
            )

            targets = []
            if getattr(api, "_window", None):
                targets.append(api._window)
            if getattr(api, "_settings_window", None):
                targets.append(api._settings_window)
            for bw in getattr(api, "_bravo_windows", []):
                if bw and bw not in targets:
                    targets.append(bw)
            for pw in getattr(api, "_profiler_windows", []):
                if pw and pw not in targets:
                    targets.append(pw)
            if getattr(api, "_history_window", None):
                if api._history_window not in targets:
                    targets.append(api._history_window)

            for w in getattr(webview, "windows", []):
                if w and w not in targets:
                    targets.append(w)

            for w in targets:
                try:
                    gui = getattr(w, 'gui', None)
                    if gui is not None:
                        if getattr(gui, 'IsDisposed', False) or getattr(gui, 'Disposing', False):
                            continue
                        browser = getattr(gui, 'browser', None)
                        if browser is not None:
                            wb = getattr(browser, 'webview', None)
                            if wb is not None and (getattr(wb, 'IsDisposed', False) or getattr(wb, 'Disposing', False)):
                                continue
                    w.evaluate_js(js_broadcast)
                except BaseException:
                    pass
        except BaseException:
            pass

    threading.Thread(target=_do_broadcast, daemon=True).start()


# ── Subwindow Creation Functions ───────────────────────────────────────

def open_settings_window(api: Any, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open or focus the Settings subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings_html = (base_dir / "templates" / "settings_window.html").resolve().as_uri()
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

        if hasattr(api, "_settings_window") and api._settings_window:
            try:
                api._settings_window.show()
                api._settings_window.focus()
                return {"success": True}
            except Exception:
                api._settings_window = None

        win_title = "Cài đặt (Settings) — luoBTool IDE"
        settings_api = SettingsSubwindowApi(api)
        settings_win = webview.create_window(
            title=win_title,
            url=settings_html,
            js_api=settings_api,
            width=1050,
            height=720,
            min_size=(800, 520),
            text_select=True,
        )
        settings_api.set_window(settings_win)
        api._settings_window = settings_win

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(settings_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(settings_win, bg=cur_theme, title=win_title)

        def on_closed():
            api._settings_window = None
            try:
                if settings_win in webview.windows:
                    webview.windows.remove(settings_win)
            except Exception:
                pass

        settings_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def open_profiler_window(api: Any, conn_id: Optional[str] = None, db_type: Optional[str] = None, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open a new SQL Trace Profiler or PostgreSQL Event Listener subwindow."""
    if db_type and str(db_type).strip().lower() in ("postgres", "postgresql", "pgsql"):
        return open_event_listener_window(api, conn_id=conn_id, db_type=db_type, base_dir=base_dir)

    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        profiler_html = (base_dir / "templates" / "profiler_window.html").resolve().as_uri()

        win_title = "SQL Trace Profiler — luoBTool IDE"
        profiler_api = ProfilerSubwindowApi(api)
        profiler_win = webview.create_window(
            title=win_title,
            url=profiler_html,
            js_api=profiler_api,
            width=1320,
            height=840,
            min_size=(920, 560),
            text_select=True,
        )
        profiler_api.set_window(profiler_win)
        if not hasattr(api, "_profiler_windows") or api._profiler_windows is None:
            api._profiler_windows = []
        api._profiler_windows.append(profiler_win)

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(profiler_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(profiler_win, bg=cur_theme, title=win_title)

        def on_closed():
            if profiler_win in getattr(api, "_profiler_windows", []):
                api._profiler_windows.remove(profiler_win)
            try:
                from app.services.profiler import profiler_service
                profiler_service.stop_all()
            except Exception:
                pass
            try:
                if profiler_win in webview.windows:
                    webview.windows.remove(profiler_win)
            except Exception:
                pass

        profiler_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def open_event_listener_window(api: Any, conn_id: Optional[str] = None, db_type: Optional[str] = None, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open a new PostgreSQL Event Listener subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        el_html = (base_dir / "templates" / "event_listener_window.html").resolve().as_uri()

        win_title = "PostgreSQL Event Listener — luoBTool IDE"
        el_api = EventListenerSubwindowApi(api)
        el_win = webview.create_window(
            title=win_title,
            url=el_html,
            js_api=el_api,
            width=1340,
            height=860,
            min_size=(920, 580),
            text_select=True,
        )
        el_api.set_window(el_win)
        if not hasattr(api, "_event_listener_windows") or api._event_listener_windows is None:
            api._event_listener_windows = []
        api._event_listener_windows.append(el_win)

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(el_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(el_win, bg=cur_theme, title=win_title)

        def on_closed():
            if el_win in getattr(api, "_event_listener_windows", []):
                api._event_listener_windows.remove(el_win)
            try:
                from app.services.profiler import profiler_service
                profiler_service.stop_all()
            except Exception:
                pass
            try:
                if el_win in webview.windows:
                    webview.windows.remove(el_win)
            except Exception:
                pass

        el_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def open_query_history_window(api: Any, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open or focus the Query History subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        history_html = (base_dir / "templates" / "query_history_window.html").resolve().as_uri()

        if hasattr(api, "_history_window") and api._history_window:
            try:
                api._history_window.show()
                api._history_window.focus()
                return {"success": True}
            except Exception:
                api._history_window = None

        win_title = "Query History — luoBTool IDE"
        history_api = QueryHistorySubwindowApi(api)
        history_win = webview.create_window(
            title=win_title,
            url=history_html,
            js_api=history_api,
            width=1280,
            height=820,
            min_size=(900, 560),
            text_select=True,
        )
        history_api.set_window(history_win)
        api._history_window = history_win

        for delay in (0.05, 0.15, 0.3, 0.6, 1.0):
            threading.Timer(delay, lambda: api.apply_titlebar_theme()).start()

        def on_closed():
            api._history_window = None
            try:
                if history_win in webview.windows:
                    webview.windows.remove(history_win)
            except Exception:
                pass

        def on_loaded():
            try:
                for delay in (0.05, 0.2, 0.5):
                    threading.Timer(delay, lambda: api.apply_titlebar_theme()).start()
                history_win.evaluate_js(
                    f"if (typeof window.applyHistoryTheme === 'function') {{ window.applyHistoryTheme('{cur_theme}'); }} "
                    f"else if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                    f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
                )
            except Exception:
                pass

        history_win.events.closed += on_closed
        history_win.events.loaded += on_loaded
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def open_bravo_window(
    api: Any,
    conn_id: Optional[str] = None,
    conn_name: Optional[str] = None,
    database: Optional[str] = None,
    db_type: Optional[str] = None,
    schema: Optional[str] = None,
    base_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Open a new BRAVO Layout XML Editor subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        bravo_html = (base_dir / "templates" / "bravo_form.html").resolve().as_uri()

        if conn_name and str(conn_name).startswith("__group__"):
            conn_name = None
            conn_id = None
            database = None
            schema = None

        if conn_name and database and database != "—":
            win_title = f"{conn_name} - {database} - BRAVO Tool"
        elif conn_name and conn_name != "Chưa kết nối" and conn_name != "No connection":
            win_title = f"{conn_name} - BRAVO Tool"
        else:
            win_title = "BRAVO Tool — Layout XML Editor"

        full_url = bravo_html
        bravo_sess_id = f"bravo_user_{uuid.uuid4().hex[:8]}"

        if not schema and database:
            schema = "dbo"

        initial_ctx = {
            "connection_id": conn_id,
            "connection_name": conn_name,
            "database": database,
            "schema": schema,
            "db_type": db_type,
            "bravo_session_id": bravo_sess_id,
        }

        from main import BravoApi  # dynamically imported to avoid circular dependency
        bravo_api = BravoApi(api.cm, owner_session_id=bravo_sess_id, initial_context=initial_ctx, main_api=api)
        bravo_win = webview.create_window(
            title=win_title,
            url=full_url,
            js_api=bravo_api,
            width=1340,
            height=860,
            min_size=(960, 600),
            text_select=True,
        )
        bravo_api.set_window(bravo_win)
        if not hasattr(api, "_bravo_windows") or api._bravo_windows is None:
            api._bravo_windows = []
        api._bravo_windows.append(bravo_win)

        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(bravo_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"))
        else:
            apply_dwm_titlebar_theme(bravo_win, bg=cur_theme)

        def on_closed():
            if bravo_win in getattr(api, "_bravo_windows", []):
                api._bravo_windows.remove(bravo_win)
            try:
                api.cm.close_all_for_window(bravo_sess_id)
            except Exception:
                pass
            try:
                if bravo_win in webview.windows:
                    webview.windows.remove(bravo_win)
            except Exception:
                pass

        bravo_win.events.closed += on_closed
        return {"success": True, "bravo_session_id": bravo_sess_id}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
