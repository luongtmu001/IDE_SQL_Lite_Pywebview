# -*- coding: utf-8 -*-
"""
Settings API Mixin.
Handles application settings, snippets, themes, clipboard, and window launchers for settings/profiler/event listener.
"""
import logging
from app.services.settings_store import (
    SETTINGS_FILE,
    SETTINGS_FILE_ALT,
    SNIPPETS_FILE,
    REDGATE_SNIPPETS_DIR,
    _get_redgate_snippets_dir,
    _read_json,
    _write_json,
    _load_settings_file,
    _save_settings_file,
    _load_snippets_file,
    _save_snippets_file,
    _import_redgate_snippets,
)
from app.desktop.themes import _process_import_vsix_theme
from app.desktop.clipboard import _native_set_clipboard, _native_get_clipboard
from app.desktop.windows import (
    open_settings_window as _desktop_open_settings_window,
    open_profiler_window as _desktop_open_profiler_window,
    open_event_listener_window as _desktop_open_event_listener_window,
    apply_titlebar_theme_to_windows as _desktop_apply_titlebar_theme,
    broadcast_settings as _desktop_broadcast_settings,
)
from app.utils.logging_setup import (
    open_log_folder as _open_log_folder,
    get_log_info as _get_log_info,
    update_log_level,
)

logger = logging.getLogger("luobtool.api.settings")


class SettingsApiMixin:
    def open_log_folder(self):
        import app.utils.logging_setup as logging_setup
        return logging_setup.open_log_folder()


    def get_log_info(self):
        import app.utils.logging_setup as logging_setup
        return {"success": True, "data": logging_setup.get_log_info()}


    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        """Đồng bộ màu sắc thanh tiêu đề Windows qua DWM API cho tất cả các cửa sổ đang mở."""
        return _desktop_apply_titlebar_theme(self, bg_hex=bg_hex, text_hex=text_hex, border_hex=border_hex, is_dark=is_dark)


    def set_clipboard_text(self, text):
        try:
            hwnd = None
            if hasattr(self, '_window') and self._window:
                native = getattr(self._window, 'native', None)
                if native:
                    handle = getattr(native, 'Handle', None)
                    if handle:
                        try:
                            hwnd = int(handle)
                        except Exception:
                            pass
            ok = _native_set_clipboard(text, hwnd)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_clipboard_text(self):
        try:
            hwnd = None
            if hasattr(self, '_window') and self._window:
                native = getattr(self._window, 'native', None)
                if native:
                    handle = getattr(native, 'Handle', None)
                    if handle:
                        try:
                            hwnd = int(handle)
                        except Exception:
                            pass
            val = _native_get_clipboard(hwnd)
            return {"success": True, "text": val}
        except Exception as exc:
            return {"success": False, "error": str(exc), "text": ""}


    def get_config(self):
        settings = _load_settings_file()
        enabled = settings.get("addons", {}).get("bravo_tool", {}).get("enabled", True)
        return {"success": True, "enabled": bool(enabled)}


    def import_vsix_theme(self, target_win=None):
        try:
            if not target_win:
                target_win = getattr(self, '_window', None)
                if not target_win and hasattr(self, '_main_api') and self._main_api:
                    target_win = getattr(self._main_api, '_window', None)

            selected_file = None
            if target_win:
                import webview
                files = target_win.create_file_dialog(
                    webview.OPEN_DIALOG,
                    allow_multiple=False,
                    file_types=('VS Code Theme Extension (*.vsix)', 'All files (*.*)')
                )
                if files and len(files) > 0:
                    selected_file = files[0]
                else:
                    return {"success": False, "cancelled": True}
            else:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                selected_file = filedialog.askopenfilename(
                    title="Chọn file giao diện VS Code (.vsix)",
                    filetypes=[("VS Code Extension (*.vsix)", "*.vsix"), ("Tất cả tệp", "*.*")]
                )
                root.destroy()
                if not selected_file:
                    return {"success": False, "cancelled": True}

            return _process_import_vsix_theme(selected_file)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(exc)}


    def open_settings_window(self):
        return _desktop_open_settings_window(self)


    def get_settings(self):
        data = _load_settings_file()
        return {"success": True, "settings": data}


    def get_snippets(self):
        try:
            data = _load_snippets_file()
            return {"success": True, "snippets": data}
        except Exception as e:
            return {"success": False, "error": str(e), "snippets": []}


    def save_snippets(self, snippets):
        try:
            ok = _save_snippets_file(snippets)
            return {"success": ok}
        except Exception as e:
            return {"success": False, "error": str(e)}


    def reset_snippets(self):
        try:
            data = _import_redgate_snippets()
            return {"success": True, "snippets": data}
        except Exception as e:
            return {"success": False, "error": str(e), "snippets": []}


    def get_code_styles(self):
        try:
            from app.services.styles_service import load_styles_file
            data = load_styles_file()
            return {"success": True, **data}
        except Exception as e:
            return {"success": False, "error": str(e)}


    def save_code_styles(self, payload):
        try:
            from app.services.styles_service import save_styles_file
            ok = save_styles_file(payload)
            return {"success": ok}
        except Exception as e:
            return {"success": False, "error": str(e)}


    def reset_code_styles(self):
        try:
            from app.services.styles_service import reset_styles_file
            data = reset_styles_file()
            return {"success": True, **data}
        except Exception as e:
            return {"success": False, "error": str(e)}


    def get_system_fonts(self):
        try:
            from app.utils.system_fonts import get_system_fonts
            fonts = get_system_fonts()
            return {"success": True, "data": fonts}
        except Exception as e:
            return {"success": False, "error": str(e), "data": {"all": [], "ui": [], "monospace": []}}


    def open_profiler_window(self, conn_id=None, db_type=None):
        return _desktop_open_profiler_window(self, conn_id=conn_id, db_type=db_type)


    def open_event_listener_window(self, conn_id=None, db_type=None):
        return _desktop_open_event_listener_window(self, conn_id=conn_id, db_type=db_type)


    def _broadcast_settings(self, settings):
        return _desktop_broadcast_settings(self, settings)


    def save_settings(self, settings):
        import sys
        main_mod = sys.modules.get("main")
        save_fn = getattr(main_mod, "_save_settings_file", _save_settings_file) if main_mod else _save_settings_file
        success = save_fn(settings)
        if isinstance(settings, dict) and "logging" in settings:
            log_cfg = settings.get("logging") or {}
            lvl = log_cfg.get("level")
            if lvl:
                update_log_level(lvl)
        self._broadcast_settings(settings)
        return {"success": success}

