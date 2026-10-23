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
from typing import Any, Dict, List, Optional, Tuple

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

    def get_settings(self):
        return self._main_api.get_settings()


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

    def history_get_stats(self):
        return self._main_api.history_get_stats()

    def history_compact(self):
        return self._main_api.history_compact()

    def history_purge(self, max_age_days=None, max_entries_per_doc=None, max_db_size_mb=None):
        return self._main_api.history_purge(max_age_days, max_entries_per_doc, max_db_size_mb)

    def history_clear_all(self, keep_favorites=False):
        return self._main_api.history_clear_all(keep_favorites)

    def get_snippets(self):
        return self._main_api.get_snippets()

    def save_snippets(self, snippets_data):
        return self._main_api.save_snippets(snippets_data)

    def reset_snippets(self):
        return self._main_api.reset_snippets()

    def get_code_styles(self):
        return self._main_api.get_code_styles()

    def save_code_styles(self, payload):
        return self._main_api.save_code_styles(payload)

    def reset_code_styles(self):
        return self._main_api.reset_code_styles()

    def open_settings_window(self):
        return self._main_api.open_settings_window()

    def get_app_version(self):
        return self._main_api.get_app_version()

    def check_for_updates(self, force=True, custom_url=None):
        return self._main_api.check_for_updates(force=force, custom_url=custom_url)

    def set_portable_mode(self, enabled=True):
        return self._main_api.set_portable_mode(enabled=enabled)

    def open_data_folder(self):
        return self._main_api.open_data_folder()

    def open_external_url(self, url):
        return self._main_api.open_external_url(url)

    def open_about_window(self):
        return self._main_api.open_about_window()

    def open_update_window(self):
        return self._main_api.open_update_window()


class AboutSubwindowApi:
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

    def get_app_version(self):
        return self._main_api.get_app_version()

    def open_external_url(self, url):
        return self._main_api.open_external_url(url)

    def open_update_window(self):
        return self._main_api.open_update_window()


class UpdateSubwindowApi:
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

    def get_app_version(self):
        return self._main_api.get_app_version()

    def check_for_updates(self, force=True, custom_url=None):
        return self._main_api.check_for_updates(force=force, custom_url=custom_url)

    def open_external_url(self, url):
        return self._main_api.open_external_url(url)

    def start_download_update(self, download_url=None, file_name=None, total_bytes_hint=0):
        from app.services.update_checker import start_download_update
        return start_download_update(
            download_url=download_url,
            file_name=file_name,
            total_bytes_hint=total_bytes_hint or 0,
        )

    def get_download_progress(self):
        from app.services.update_checker import get_download_progress
        return get_download_progress()

    def cancel_download(self):
        from app.services.update_checker import cancel_download
        return cancel_download()

    def _dismiss_main_update_indicator(self):
        try:
            target_win = getattr(self._main_api, '_window', None)
            if not target_win and hasattr(webview, "windows") and webview.windows:
                target_win = webview.windows[0]
            if target_win:
                target_win.evaluate_js(
                    "if (window.dismissAppUpdate) { window.dismissAppUpdate(); } "
                    "var btn = document.getElementById('ide-update-btn'); if (btn) btn.classList.add('d-none');"
                )
        except Exception as exc:
            logger.debug("[UpdateSubwindowApi] Failed to dismiss update badge: %s", exc)

    def open_downloaded_file(self, file_path=None):
        from app.services.update_checker import open_downloaded_file
        res = open_downloaded_file(file_path=file_path)
        self._dismiss_main_update_indicator()
        return res

    def open_containing_folder(self, file_path=None):
        from app.services.update_checker import open_containing_folder
        return open_containing_folder(file_path=file_path)


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

    def profiler_list_connections(self):
        return self._main_api.profiler_list_connections()

    def profiler_pause_trace(self, session_id):
        return self._main_api.profiler_pause_trace(session_id)

    def profiler_resume_trace(self, session_id):
        return self._main_api.profiler_resume_trace(session_id)

    def profiler_stop_trace(self, session_id):
        return self._main_api.profiler_stop_trace(session_id)

    def profiler_get_status(self, session_id):
        return self._main_api.profiler_get_status(session_id)


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

    def set_clipboard_text(self, text):
        return self._main_api.set_clipboard_text(text)

    def get_clipboard_text(self):
        return self._main_api.get_clipboard_text()


class ActivityMonitorSubwindowApi:
    """JS Bridge for standalone Pop-out Activity Monitor subwindows."""

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

    def activity_get_sessions(self, connection_id, database=None, active_only=False):
        return self._main_api.activity_get_sessions(connection_id, database=database, active_only=active_only)

    def activity_cancel_session(self, connection_id, session_id):
        return self._main_api.activity_cancel_session(connection_id, session_id)

    def activity_kill_session(self, connection_id, session_id):
        return self._main_api.activity_kill_session(connection_id, session_id)

    def activity_get_current_spid(self, connection_id):
        return self._main_api.activity_get_current_spid(connection_id)

    def get_saved_connections(self):
        return self._main_api.get_saved_connections()

    def get_settings(self):
        return self._main_api.get_settings()

    def set_clipboard_text(self, text):
        return self._main_api.set_clipboard_text(text)

    def get_clipboard_text(self):
        return self._main_api.get_clipboard_text()


class GoogleSheetsSubwindowApi:
    """JS Bridge for standalone Google Sheets Workspace subwindow."""

    def __init__(self, main_api):
        self._main_api = main_api
        self._window = None
        self._editor_host = None

    def set_window(self, win):
        self._window = win
        if self._editor_host:
            self._editor_host.set_window(win)

    def get_editor_host(self):
        if self._editor_host is None:
            try:
                from app.services.google_sheets.editor_host import GoogleSheetsEditorHost
                self._editor_host = GoogleSheetsEditorHost(window=self._window)
            except Exception as e:
                logger.exception("Error initializing GoogleSheetsEditorHost: %s", e)
        elif self._window and self._editor_host._window != self._window:
            self._editor_host.set_window(self._window)
        return self._editor_host

    def gs_editor_host_init(self):
        host = self.get_editor_host()
        if host:
            return host.initialize(self._window)
        return {"success": False, "error": "Editor host unavailable"}

    def gs_editor_host_navigate(self, url: str):
        host = self.get_editor_host()
        if host:
            return host.navigate(url)
        return {"success": False, "error": "Editor host unavailable"}

    def gs_editor_host_set_bounds(self, x: int, y: int, width: int, height: int, visible: bool = True, dpr=None):
        host = self.get_editor_host()
        if host:
            return host.set_bounds(x, y, width, height, visible, dpr)
        return {"success": False, "error": "Editor host unavailable"}

    def gs_editor_host_set_visible(self, visible: bool):
        host = self.get_editor_host()
        if host:
            return host.set_visible(visible)
        return {"success": False, "error": "Editor host unavailable"}

    def gs_editor_host_get_state(self):
        host = self.get_editor_host()
        if host:
            return host.get_state()
        return {"success": False, "error": "Editor host unavailable"}

    def gs_editor_host_dispose(self):
        if self._editor_host:
            res = self._editor_host.dispose()
            self._editor_host = None
            return res
        return {"success": True, "status": "already_disposed"}

    def close_window(self):
        self.gs_editor_host_dispose()
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
        return {"success": True}

    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        return self._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)

    def get_settings(self):
        return self._main_api.get_settings()

    def get_theme(self):
        settings = _load_settings_file()
        return settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

    # ─── Explicitly declared methods for pywebview JS API reflection ──────────
    def gs_validate_url(self, raw_url: str):
        return self._main_api.gs_validate_url(raw_url)

    def gs_list_projects(self):
        return self._main_api.gs_list_projects()

    def gs_get_project(self, project_id: str):
        return self._main_api.gs_get_project(project_id)

    def gs_create_project(self, name: str, description: str = "", color: str = "#3B82F6"):
        return self._main_api.gs_create_project(name, description=description, color=color)

    def gs_update_project(self, project_id: str, name=None, description=None, color=None):
        return self._main_api.gs_update_project(project_id, name=name, description=description, color=color)

    def gs_delete_project(self, project_id: str):
        return self._main_api.gs_delete_project(project_id)

    def gs_add_sheet(self, project_id: str, title: str, url: str, tags=None, notes: str = "", favorite: bool = False):
        return self._main_api.gs_add_sheet(project_id, title=title, url=url, tags=tags, notes=notes, favorite=favorite)

    def gs_update_sheet(self, project_id: str, sheet_id: str, title=None, url=None, tags=None, notes=None):
        return self._main_api.gs_update_sheet(project_id, sheet_id, title=title, url=url, tags=tags, notes=notes)

    def gs_save_sheet_grid(self, project_id: str, sheet_id: str, grid_data=None):
        return self._main_api.gs_save_sheet_grid(project_id, sheet_id, grid_data=grid_data)

    def gs_fetch_sheet_data(self, project_id: str, sheet_id: str):
        return self._main_api.gs_fetch_sheet_data(project_id, sheet_id)

    def gs_remove_sheet(self, project_id: str, sheet_id: str):
        return self._main_api.gs_remove_sheet(project_id, sheet_id)

    def gs_toggle_favorite(self, project_id: str, sheet_id: str):
        return self._main_api.gs_toggle_favorite(project_id, sheet_id)

    def gs_move_sheet(self, source_project_id: str, target_project_id: str, sheet_id: str):
        return self._main_api.gs_move_sheet(source_project_id, target_project_id, sheet_id)

    def gs_search_sheets(self, query: str = "", tag=None, favorite_only: bool = False):
        return self._main_api.gs_search_sheets(query=query, tag=tag, favorite_only=favorite_only)

    def gs_get_workspace(self):
        return self._main_api.gs_get_workspace()

    def gs_save_workspace(self, last_project_id=None, last_opened_sheet_id=None):
        return self._main_api.gs_save_workspace(last_project_id=last_project_id, last_opened_sheet_id=last_opened_sheet_id)

    def gs_open_sheet_window(self, project_id: str, sheet_id: str):
        return self._main_api.gs_open_sheet_window(project_id, sheet_id)

    def gs_close_sheet_window(self, sheet_id: str):
        return self._main_api.gs_close_sheet_window(sheet_id)

    def gs_open_in_browser(self, url: str):
        return self._main_api.gs_open_in_browser(url)

    def gs_get_open_sheet_ids(self):
        return self._main_api.gs_get_open_sheet_ids()

    def gs_open_manager_window(self):
        return self._main_api.gs_open_manager_window()

    def __getattr__(self, name):
        """Fallback for any future or unlisted methods."""
        return getattr(self._main_api, name)


class SchemaCompareSubwindowApi:
    """JS Bridge for standalone Pop-out Schema Compare subwindows."""

    def __init__(self, main_api, initial_options=None):
        self._main_api = main_api
        self._initial_options = initial_options or {}
        self._window = None

    def get_initial_options(self):
        return self._initial_options

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

    def schema_compare_get_connections(self):
        return self._main_api.schema_compare_get_connections()

    def schema_compare_get_schemas(self, connection_id, database=None):
        return self._main_api.schema_compare_get_schemas(connection_id, database=database)

    def schema_compare_run(self, source_conn_id, source_db, source_schema, target_conn_id, target_db, target_schema, object_types=None):
        return self._main_api.schema_compare_run(
            source_conn_id, source_db, source_schema, target_conn_id, target_db, target_schema, object_types=object_types
        )

    def schema_compare_cancel(self):
        return self._main_api.schema_compare_cancel()

    def schema_compare_generate_script(self, diff_data, selected_tables=None, options=None):
        return self._main_api.schema_compare_generate_script(diff_data, selected_tables=selected_tables, options=options)

    def schema_compare_connect_direct(self, config):
        return self._main_api.schema_compare_connect_direct(config)

    def fetch_connection_metadata(self, config):
        return self._main_api.fetch_connection_metadata(config)

    def select_sqlite_file(self):
        return self._main_api.select_sqlite_file()

    def get_settings(self):
        return self._main_api.get_settings()

    def set_clipboard_text(self, text):
        return self._main_api.set_clipboard_text(text)

    def get_clipboard_text(self):
        return self._main_api.get_clipboard_text()

    def save_connection_profile(self, profile):
        if hasattr(self._main_api, 'save_connection_profile'):
            return self._main_api.save_connection_profile(profile)
        return {"success": False, "error": "Not supported"}

    def show_open_file_dialog(self, title=None, filters=None):
        if hasattr(self._main_api, 'show_open_file_dialog'):
            return self._main_api.show_open_file_dialog(title=title, filters=filters)
        return None

    def schema_compare_bravo_layout_list(self, connection_id, database=None, platform="Win", version="Bravo 10", search_term=""):
        return self._main_api.schema_compare_bravo_layout_list(
            connection_id, database=database, platform=platform, version=version, search_term=search_term
        )

    def schema_compare_bravo_layout_detail(self, connection_id, layout_id, database=None, platform="Win", version="Bravo 10"):
        return self._main_api.schema_compare_bravo_layout_detail(
            connection_id, layout_id, database=database, platform=platform, version=version
        )

    def schema_compare_bravo_layout_generate_script(self, connection_id, layout_id, layout_xml, draft_layout_xml=None, expected_modified_at=None, form_name="", layout_name="", platform="Win", version="Bravo 10", database=None):
        return self._main_api.schema_compare_bravo_layout_generate_script(
            connection_id, layout_id, layout_xml, draft_layout_xml=draft_layout_xml, expected_modified_at=expected_modified_at, form_name=form_name, layout_name=layout_name, platform=platform, version=version, database=database
        )

    def schema_compare_bravo_layout_apply_update(self, connection_id, layout_id, layout_xml, draft_layout_xml=None, expected_modified_at=None, database=None, platform="Win", version="Bravo 10"):
        return self._main_api.schema_compare_bravo_layout_apply_update(
            connection_id, layout_id, layout_xml, draft_layout_xml=draft_layout_xml, expected_modified_at=expected_modified_at, database=database, platform=platform, version=version
        )



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

        # 7. Activity Monitor Windows
        for aw in getattr(api, "_activity_windows", []):
            if aw:
                apply_dwm_titlebar_theme(
                    aw,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="Giám sát phiên & Khóa chặn (Activity Monitor) — luoBTool IDE",
                )

        # 8. Schema Compare Windows
        for scw in getattr(api, "_schema_compare_windows", []):
            if scw:
                apply_dwm_titlebar_theme(
                    scw,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="So sánh Schema giữa 2 Database (Schema Compare) — luoBTool IDE",
                )

        # 9. Result Comparator Windows
        for rcw in getattr(api, "_result_comparator_windows", []):
            if rcw:
                apply_dwm_titlebar_theme(
                    rcw,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="So sánh kết quả truy vấn (Result Comparator) — luoBTool IDE",
                )

        # 10. Google Sheets Workspace Window
        if getattr(api, "_google_sheets_manager_window", None):
            apply_dwm_titlebar_theme(
                api._google_sheets_manager_window,
                bg=bg_hex,
                text=text_hex,
                border=border_hex,
                is_dark=is_dark,
                title="Google Sheets Workspace — luoBTool IDE",
            )

        # 11. Google Sheets Companion Windows
        try:
            from app.services.google_sheets.webview_host import get_window_manager
            wm = get_window_manager()
            if wm:
                for comp_win in wm.get_open_windows():
                    if comp_win:
                        apply_dwm_titlebar_theme(
                            comp_win,
                            bg=bg_hex,
                            text=text_hex,
                            border=border_hex,
                            is_dark=is_dark,
                        )
        except Exception as exc:
            logger.debug("[Windows] Error updating companion windows theme: %s", exc)

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
            for aw in getattr(api, "_activity_windows", []):
                if aw and aw not in targets:
                    targets.append(aw)
            for scw in getattr(api, "_schema_compare_windows", []):
                if scw and scw not in targets:
                    targets.append(scw)
            for rcw in getattr(api, "_result_comparator_windows", []):
                if rcw and rcw not in targets:
                    targets.append(rcw)
            if getattr(api, "_history_window", None):
                if api._history_window not in targets:
                    targets.append(api._history_window)
            if getattr(api, "_google_sheets_manager_window", None):
                if api._google_sheets_manager_window not in targets:
                    targets.append(api._google_sheets_manager_window)

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

def calculate_centered_coordinates(
    target_width: int,
    target_height: int,
    api: Optional[Any] = None,
) -> Tuple[int, int, Optional[Any]]:
    """
    Calculate (cx, cy, target_screen) in logical coordinates so that
    a newly opened subwindow is always centered on the active screen / monitor
    where the main IDE window resides.
    """
    screens = []
    try:
        screens = getattr(webview, "screens", []) or []
    except Exception:
        screens = []

    # Find the main window if available
    main_win = None
    if api is not None:
        main_win = getattr(api, "_window", None)
        if not main_win and hasattr(api, "_main_api"):
            main_win = getattr(api._main_api, "_window", None)
    if not main_win and getattr(webview, "windows", None):
        try:
            main_win = webview.windows[0]
        except Exception:
            main_win = None

    target_screen = None
    if screens:
        if len(screens) == 1:
            target_screen = screens[0]
        elif main_win:
            try:
                mx = getattr(main_win, "x", None)
                my = getattr(main_win, "y", None)
                mw = getattr(main_win, "width", None)
                mh = getattr(main_win, "height", None)
                if mx is not None and my is not None and mw and mh:
                    mcx = mx + mw // 2
                    mcy = my + mh // 2
                    for sc in screens:
                        if (sc.x <= mcx < sc.x + sc.width) and (sc.y <= mcy < sc.y + sc.height):
                            target_screen = sc
                            break
            except Exception:
                pass
        if not target_screen:
            target_screen = screens[0]

    if target_screen:
        sx = getattr(target_screen, "x", 0)
        sy = getattr(target_screen, "y", 0)
        sw = getattr(target_screen, "width", 1920)
        sh = getattr(target_screen, "height", 1080)
        cx = sx + max(0, (sw - target_width) // 2)
        cy = sy + max(0, (sh - target_height) // 2)
        return int(cx), int(cy), target_screen

    # Fallback to ctypes user32 metrics
    try:
        import ctypes
        user32 = ctypes.windll.user32
        sw = user32.GetSystemMetrics(0)
        sh = user32.GetSystemMetrics(1)
        cx = max(0, (sw - target_width) // 2)
        cy = max(0, (sh - target_height) // 2)
        return int(cx), int(cy), None
    except Exception:
        return 100, 100, None


def open_settings_window(api: Any, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open or focus the Settings subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings_html = (base_dir / "templates" / "settings_window.html").resolve().as_uri()
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

        w, h = 1050, 720
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        if hasattr(api, "_settings_window") and api._settings_window:
            try:
                try:
                    api._settings_window.move(cx, cy)
                except Exception:
                    pass
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
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(800, 520),
            text_select=True,
        )
        settings_api.set_window(settings_win)
        api._settings_window = settings_win

        def _center_on_shown():
            try:
                settings_win.move(cx, cy)
            except Exception:
                pass

        settings_win.events.shown += _center_on_shown

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


def open_about_window(api: Any, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open or focus the About subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        candidate_paths = [
            base_dir / "templates" / "about_window.html",
            base_dir / "_internal" / "templates" / "about_window.html",
            Path(__file__).resolve().parent.parent.parent / "templates" / "about_window.html",
        ]
        chosen_path = None
        for cand in candidate_paths:
            if cand.exists():
                chosen_path = cand
                break
        if not chosen_path:
            chosen_path = candidate_paths[0]

        about_html = chosen_path.resolve().as_uri()
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

        w, h = 580, 460
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        if hasattr(api, "_about_window") and api._about_window:
            try:
                try:
                    api._about_window.move(cx, cy)
                except Exception:
                    pass
                api._about_window.show()
                api._about_window.focus()
                return {"success": True}
            except Exception:
                api._about_window = None

        win_title = "Thông tin phần mềm — luoBTool IDE"
        about_api = AboutSubwindowApi(api)
        about_win = webview.create_window(
            title=win_title,
            url=about_html,
            js_api=about_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(480, 380),
            text_select=True,
            resizable=True,
        )
        about_api.set_window(about_win)
        api._about_window = about_win

        def _center_on_shown():
            try:
                about_win.move(cx, cy)
            except Exception:
                pass

        about_win.events.shown += _center_on_shown

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(about_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(about_win, bg=cur_theme, title=win_title)

        def on_closed():
            api._about_window = None
            try:
                if about_win in webview.windows:
                    webview.windows.remove(about_win)
            except Exception:
                pass

        about_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        logger.exception("Error opening about window: %s", exc)
        return {"success": False, "error": str(exc)}


def open_update_window(api: Any, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open or focus the Check for Updates subwindow."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        candidate_paths = [
            base_dir / "templates" / "update_window.html",
            base_dir / "_internal" / "templates" / "update_window.html",
            Path(__file__).resolve().parent.parent.parent / "templates" / "update_window.html",
        ]
        chosen_path = None
        for cand in candidate_paths:
            if cand.exists():
                chosen_path = cand
                break
        if not chosen_path:
            chosen_path = candidate_paths[0]

        update_html = chosen_path.resolve().as_uri()
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

        w, h = 620, 500
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        if hasattr(api, "_update_window") and api._update_window:
            try:
                try:
                    api._update_window.move(cx, cy)
                except Exception:
                    pass
                api._update_window.show()
                api._update_window.focus()
                return {"success": True}
            except Exception:
                api._update_window = None

        win_title = "Kiểm tra Cập nhật — luoBTool IDE"
        update_api = UpdateSubwindowApi(api)
        update_win = webview.create_window(
            title=win_title,
            url=update_html,
            js_api=update_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(500, 420),
            text_select=True,
            resizable=True,
        )
        update_api.set_window(update_win)
        api._update_window = update_win

        def _center_on_shown():
            try:
                update_win.move(cx, cy)
            except Exception:
                pass

        update_win.events.shown += _center_on_shown

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(update_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(update_win, bg=cur_theme, title=win_title)

        def on_closed():
            api._update_window = None
            try:
                if update_win in webview.windows:
                    webview.windows.remove(update_win)
            except Exception:
                pass

        update_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        logger.exception("Error opening update window: %s", exc)
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

        w, h = 1320, 840
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        win_title = "SQL Trace Profiler — luoBTool IDE"
        profiler_api = ProfilerSubwindowApi(api)
        profiler_win = webview.create_window(
            title=win_title,
            url=profiler_html,
            js_api=profiler_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(920, 560),
            text_select=True,
        )
        profiler_api.set_window(profiler_win)
        if not hasattr(api, "_profiler_windows") or api._profiler_windows is None:
            api._profiler_windows = []
        api._profiler_windows.append(profiler_win)

        def _center_on_shown():
            try:
                profiler_win.move(cx, cy)
            except Exception:
                pass

        profiler_win.events.shown += _center_on_shown

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

        w, h = 1340, 860
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        win_title = "PostgreSQL Event Listener — luoBTool IDE"
        el_api = EventListenerSubwindowApi(api)
        el_win = webview.create_window(
            title=win_title,
            url=el_html,
            js_api=el_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(920, 580),
            text_select=True,
        )
        el_api.set_window(el_win)
        if not hasattr(api, "_event_listener_windows") or api._event_listener_windows is None:
            api._event_listener_windows = []
        api._event_listener_windows.append(el_win)

        def _center_on_shown():
            try:
                el_win.move(cx, cy)
            except Exception:
                pass

        el_win.events.shown += _center_on_shown

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

        w, h = 1280, 820
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        if hasattr(api, "_history_window") and api._history_window:
            try:
                try:
                    api._history_window.move(cx, cy)
                except Exception:
                    pass
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
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(900, 560),
            text_select=True,
        )
        history_api.set_window(history_win)
        api._history_window = history_win

        def _center_on_shown():
            try:
                history_win.move(cx, cy)
            except Exception:
                pass

        history_win.events.shown += _center_on_shown

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
        candidate_paths = [
            base_dir / "templates" / "bravo_form.html",
            base_dir / "_internal" / "templates" / "bravo_form.html",
            Path(__file__).resolve().parent.parent.parent / "templates" / "bravo_form.html",
        ]
        chosen_path = None
        for cand in candidate_paths:
            if cand.exists():
                chosen_path = cand
                break
        if not chosen_path:
            chosen_path = candidate_paths[0]
        bravo_html = chosen_path.resolve().as_uri()

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

        w, h = 1340, 860
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        from main import BravoApi  # dynamically imported to avoid circular dependency
        bravo_api = BravoApi(api.cm, owner_session_id=bravo_sess_id, initial_context=initial_ctx, main_api=api)
        bravo_win = webview.create_window(
            title=win_title,
            url=full_url,
            js_api=bravo_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(960, 600),
            text_select=True,
        )
        bravo_api.set_window(bravo_win)
        if not hasattr(api, "_bravo_windows") or api._bravo_windows is None:
            api._bravo_windows = []
        api._bravo_windows.append(bravo_win)

        def _center_on_shown():
            try:
                bravo_win.move(cx, cy)
            except Exception:
                pass

        bravo_win.events.shown += _center_on_shown

        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(bravo_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"))
        else:
            apply_dwm_titlebar_theme(bravo_win, bg=cur_theme)

        def on_loaded():
            try:
                for delay in (0.05, 0.2, 0.5):
                    threading.Timer(delay, lambda: api.apply_titlebar_theme()).start()
                bravo_win.evaluate_js(
                    f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                    f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
                    f"const _l = document.getElementById('bravo-initial-loader'); if (_l) {{ _l.style.opacity = '0'; setTimeout(() => _l.remove(), 250); }}"
                )
            except Exception:
                pass

        bravo_win.events.loaded += on_loaded

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


def open_activity_monitor_window(api: Any, conn_id: Optional[str] = None, db_type: Optional[str] = None, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open a new Activity & Locks Monitor subwindow (Pop-out mode)."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        activity_html = (base_dir / "templates" / "activity_monitor_window.html").resolve().as_uri()

        w, h = 1320, 840
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        win_title = "Giám sát phiên & Khóa chặn (Activity Monitor) — luoBTool IDE"
        act_api = ActivityMonitorSubwindowApi(api)
        act_win = webview.create_window(
            title=win_title,
            url=activity_html,
            js_api=act_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(920, 560),
            text_select=True,
        )
        act_api.set_window(act_win)
        if not hasattr(api, "_activity_windows") or api._activity_windows is None:
            api._activity_windows = []
        api._activity_windows.append(act_win)

        def _center_on_shown():
            try:
                act_win.move(cx, cy)
            except Exception:
                pass

        act_win.events.shown += _center_on_shown

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(act_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(act_win, bg=cur_theme, title=win_title)

        def on_closed():
            if act_win in getattr(api, "_activity_windows", []):
                api._activity_windows.remove(act_win)
            try:
                if act_win in webview.windows:
                    webview.windows.remove(act_win)
            except Exception:
                pass

        act_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        logger.exception("Error opening activity monitor window: %s", exc)
        return {"success": False, "error": str(exc)}


def open_schema_compare_window(
    api: Any,
    source_conn_id: Optional[str] = None,
    source_db: Optional[str] = None,
    source_schema: Optional[str] = None,
    target_conn_id: Optional[str] = None,
    target_db: Optional[str] = None,
    target_schema: Optional[str] = None,
    base_dir: Optional[Path] = None
) -> Dict[str, Any]:
    """Open a new Schema Compare subwindow (Pop-out mode)."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        
        # Resolve html path with fallback to _internal and templates directories
        candidate_paths = [
            base_dir / "templates" / "schema_compare_window.html",
            base_dir / "_internal" / "templates" / "schema_compare_window.html",
            Path(__file__).resolve().parent.parent.parent / "templates" / "schema_compare_window.html"
        ]
        chosen_path = None
        for cand in candidate_paths:
            if cand.exists():
                chosen_path = cand
                break
        if not chosen_path:
            chosen_path = candidate_paths[0]
        html_path = chosen_path.resolve().as_uri()

        initial_options = {
            "sourceConnId": source_conn_id,
            "sourceDb": source_db,
            "sourceSchema": source_schema,
            "targetConnId": target_conn_id,
            "targetDb": target_db,
            "targetSchema": target_schema,
        }

        w, h = 1340, 860
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        win_title = "So sánh Schema giữa 2 Database (Schema Compare) — luoBTool IDE"
        sub_api = SchemaCompareSubwindowApi(api, initial_options=initial_options)
        sub_win = webview.create_window(
            title=win_title,
            url=html_path,
            js_api=sub_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(960, 600),
            text_select=True,
        )
        sub_api.set_window(sub_win)
        if not hasattr(api, "_schema_compare_windows") or api._schema_compare_windows is None:
            api._schema_compare_windows = []
        api._schema_compare_windows.append(sub_win)

        def _center_on_shown():
            try:
                sub_win.move(cx, cy)
            except Exception:
                pass

        sub_win.events.shown += _center_on_shown

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(sub_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(sub_win, bg=cur_theme, title=win_title)

        def on_closed():
            if sub_win in getattr(api, "_schema_compare_windows", []):
                api._schema_compare_windows.remove(sub_win)
            try:
                if sub_win in webview.windows:
                    webview.windows.remove(sub_win)
            except Exception:
                pass

        sub_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        logger.exception("Error opening schema compare window: %s", exc)
        return {"success": False, "error": str(exc)}


class ResultComparatorSubwindowApi:
    """JS Bridge for standalone Pop-out Result Comparator subwindows."""

    def __init__(self, main_api, initial_data=None):
        self._main_api = main_api
        self._initial_data = initial_data or {}
        self._window = None

    def get_initial_data(self):
        return self._initial_data

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

    def get_settings(self):
        return self._main_api.get_settings()


def open_result_comparator_window(
    api: Any,
    payload: Optional[Dict[str, Any]] = None,
    base_dir: Optional[Path] = None
) -> Dict[str, Any]:
    """Open a new Result Comparator subwindow (Pop-out mode)."""
    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

        candidate_paths = [
            base_dir / "templates" / "result_comparator_window.html",
            base_dir / "_internal" / "templates" / "result_comparator_window.html",
            Path(__file__).resolve().parent.parent.parent / "templates" / "result_comparator_window.html"
        ]
        chosen_path = None
        for cand in candidate_paths:
            if cand.exists():
                chosen_path = cand
                break
        if not chosen_path:
            chosen_path = candidate_paths[0]
        html_path = chosen_path.resolve().as_uri()

        w, h = 1380, 880
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        win_title = "So sánh kết quả truy vấn (Result Comparator) — luoBTool IDE"
        sub_api = ResultComparatorSubwindowApi(api, initial_data=payload)
        sub_win = webview.create_window(
            title=win_title,
            url=html_path,
            js_api=sub_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(960, 600),
            text_select=True,
        )
        sub_api.set_window(sub_win)
        if not hasattr(api, "_result_comparator_windows") or api._result_comparator_windows is None:
            api._result_comparator_windows = []
        api._result_comparator_windows.append(sub_win)

        def _center_on_shown():
            try:
                sub_win.move(cx, cy)
            except Exception:
                pass

        sub_win.events.shown += _center_on_shown

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(sub_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(sub_win, bg=cur_theme, title=win_title)

        def on_closed():
            if sub_win in getattr(api, "_result_comparator_windows", []):
                api._result_comparator_windows.remove(sub_win)
            try:
                if sub_win in webview.windows:
                    webview.windows.remove(sub_win)
            except Exception:
                pass

        sub_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        logger.exception("Error opening result comparator window: %s", exc)
        return {"success": False, "error": str(exc)}


_google_sheets_window_lock = threading.Lock()
_google_sheets_is_opening = False


def open_google_sheets_window(api: Any, base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Open or focus the dedicated Google Sheets Workspace subwindow."""
    global _google_sheets_is_opening
    if base_dir is None:
        base_dir = get_bundle_dir()

    with _google_sheets_window_lock:
        if hasattr(api, "_google_sheets_manager_window") and api._google_sheets_manager_window:
            try:
                sub_win = api._google_sheets_manager_window
                w, h = 1320, 840
                cx, cy, _ = calculate_centered_coordinates(w, h, api)
                try:
                    sub_win.move(cx, cy)
                except Exception:
                    pass
                sub_win.show()
                sub_win.focus()
                return {"success": True}
            except Exception:
                api._google_sheets_manager_window = None

        if _google_sheets_is_opening:
            logger.info("[GoogleSheets] Window opening is already in progress, skipping concurrent duplicate.")
            return {"success": True}

        _google_sheets_is_opening = True

    try:
        candidate_paths = [
            base_dir / "templates" / "google_sheets_window.html",
            base_dir / "_internal" / "templates" / "google_sheets_window.html",
            Path(__file__).resolve().parent.parent.parent / "templates" / "google_sheets_window.html"
        ]
        chosen_path = None
        for cand in candidate_paths:
            if cand.exists():
                chosen_path = cand
                break
        if not chosen_path:
            chosen_path = candidate_paths[0]
        html_path = chosen_path.resolve().as_uri()

        settings = _load_settings_file()
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

        w, h = 1320, 840
        cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

        win_title = "Google Sheets Workspace — luoBTool IDE"
        sub_api = GoogleSheetsSubwindowApi(api)
        sub_win = webview.create_window(
            title=win_title,
            url=html_path,
            js_api=sub_api,
            width=w,
            height=h,
            x=cx,
            y=cy,
            screen=target_screen,
            min_size=(960, 600),
            text_select=True,
        )
        sub_api.set_window(sub_win)
        with _google_sheets_window_lock:
            api._google_sheets_manager_window = sub_win

        def _center_on_shown():
            try:
                sub_win.move(cx, cy)
            except Exception:
                pass

        def _apply_theme_on_loaded():
            try:
                sub_win.evaluate_js(
                    f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                    f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
                )
            except Exception:
                pass

        sub_win.events.shown += _center_on_shown
        sub_win.events.loaded += _apply_theme_on_loaded

        if getattr(api, "_current_titlebar_theme", None):
            t = api._current_titlebar_theme
            apply_dwm_titlebar_theme(sub_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
        else:
            apply_dwm_titlebar_theme(sub_win, bg=cur_theme, title=win_title)

        def on_closed():
            try:
                sub_api.gs_editor_host_dispose()
            except Exception:
                pass
            with _google_sheets_window_lock:
                api._google_sheets_manager_window = None
            try:
                if sub_win in webview.windows:
                    webview.windows.remove(sub_win)
            except Exception:
                pass

        sub_win.events.closed += on_closed
        return {"success": True}
    except Exception as exc:
        logger.exception("Error opening google sheets window: %s", exc)
        return {"success": False, "error": str(exc)}
    finally:
        with _google_sheets_window_lock:
            _google_sheets_is_opening = False


# ── Cross-Database Syntax Reference & Compare Subwindow ────────────────────

class SyntaxReferenceSubwindowApi:
    """JS Bridge for standalone Syntax Reference & Compare subwindow."""

    def __init__(self, main_api, initial_filter=None):
        self._main_api = main_api
        self._initial_filter = initial_filter or {}
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

    def get_settings(self):
        return self._main_api.get_settings()

    def get_initial_filter(self):
        return self._initial_filter

    def search_syntax_catalog(self, query="", database=None, category=None, status=None, is_exclusive=None):
        return self._main_api.search_syntax_catalog(query=query, database=database, category=category, status=status, is_exclusive=is_exclusive)

    def get_syntax_entry(self, syntax_id):
        return self._main_api.get_syntax_entry(syntax_id)

    def get_syntax_concept(self, concept_id):
        return self._main_api.get_syntax_concept(concept_id)

    def get_syntax_manifest(self):
        return self._main_api.get_syntax_manifest()

    def compare_syntax_selection(self, sql_text, source_db="postgresql", target_db="sqlserver"):
        return self._main_api.compare_syntax_selection(sql_text=sql_text, source_db=source_db, target_db=target_db)

    def insert_to_active_editor(self, sql_content):
        return self._main_api.syntax_catalog_insert_to_editor(sql_content)

    def open_external_url(self, url):
        return self._main_api.open_external_url(url)


_syntax_ref_window_lock = threading.RLock()
_syntax_ref_is_opening = False


def open_syntax_reference_window(
    api: Any,
    initial_filter: Optional[Dict[str, Any]] = None,
    base_dir: Optional[Path] = None
) -> Dict[str, Any]:
    """Open or focus the Syntax Reference & Compare desktop subwindow."""
    global _syntax_ref_is_opening
    if base_dir is None:
        base_dir = get_bundle_dir()

    with _syntax_ref_window_lock:
        if hasattr(api, "_syntax_reference_window") and api._syntax_reference_window:
            try:
                sub_win = api._syntax_reference_window
                w, h = 1260, 800
                cx, cy, _ = calculate_centered_coordinates(w, h, api)
                try:
                    sub_win.move(cx, cy)
                except Exception:
                    pass
                sub_win.show()
                sub_win.focus()
                if initial_filter:
                    import json
                    payload = json.dumps(initial_filter)
                    try:
                        sub_win.evaluate_js(f"if (window.applyInitialContext) {{ window.applyInitialContext({payload}); }}")
                    except Exception:
                        pass
                return {"success": True}
            except Exception:
                api._syntax_reference_window = None

        if _syntax_ref_is_opening:
            logger.info("[SyntaxReference] Window opening is already in progress, skipping concurrent duplicate.")
            return {"success": True}

        _syntax_ref_is_opening = True

        try:
            settings = _load_settings_file()
            cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")

            candidate_paths = [
                base_dir / "templates" / "syntax_reference_window.html",
                base_dir / "_internal" / "templates" / "syntax_reference_window.html",
                Path(__file__).resolve().parent.parent.parent / "templates" / "syntax_reference_window.html",
            ]
            chosen_path = None
            for cand in candidate_paths:
                if cand.exists():
                    chosen_path = cand
                    break
            if not chosen_path:
                chosen_path = candidate_paths[0]
            html_path = chosen_path.resolve().as_uri()

            w, h = 1260, 800
            cx, cy, target_screen = calculate_centered_coordinates(w, h, api)

            win_title = "Tra cứu & Đối chiếu cú pháp (PostgreSQL & SQL Server) — luoBTool IDE"
            sub_api = SyntaxReferenceSubwindowApi(api, initial_filter=initial_filter)
            sub_win = webview.create_window(
                title=win_title,
                url=html_path,
                js_api=sub_api,
                width=w,
                height=h,
                x=cx,
                y=cy,
                screen=target_screen,
                min_size=(920, 560),
                text_select=True,
            )
            sub_api.set_window(sub_win)
            api._syntax_reference_window = sub_win

            def _center_on_shown():
                try:
                    sub_win.move(cx, cy)
                except Exception:
                    pass

            def _apply_theme_on_loaded():
                try:
                    sub_win.evaluate_js(
                        f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                        f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
                    )
                    if initial_filter:
                        import json
                        payload = json.dumps(initial_filter)
                        sub_win.evaluate_js(f"if (window.applyInitialContext) {{ window.applyInitialContext({payload}); }}")
                except Exception:
                    pass

            sub_win.events.shown += _center_on_shown
            sub_win.events.loaded += _apply_theme_on_loaded

            if getattr(api, "_current_titlebar_theme", None):
                t = api._current_titlebar_theme
                apply_dwm_titlebar_theme(sub_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
            else:
                apply_dwm_titlebar_theme(sub_win, bg=cur_theme, title=win_title)

            def on_closed():
                with _syntax_ref_window_lock:
                    api._syntax_reference_window = None
                try:
                    if sub_win in webview.windows:
                        webview.windows.remove(sub_win)
                except Exception:
                    pass

            sub_win.events.closed += on_closed
            return {"success": True}
        except Exception as exc:
            logger.exception("Error opening syntax reference window: %s", exc)
            return {"success": False, "error": str(exc)}
        finally:
            _syntax_ref_is_opening = False




