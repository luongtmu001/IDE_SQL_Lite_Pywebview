# -*- coding: utf-8 -*-
import logging
import sys
import threading
import uuid
from pathlib import Path

# Resolve bundle and app directories for both development and PyInstaller frozen modes
if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).resolve().parent
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass and (Path(meipass) / "templates").exists():
        BUNDLE_DIR = Path(meipass).resolve()
    elif (APP_DIR / "_internal" / "templates").exists():
        BUNDLE_DIR = APP_DIR / "_internal"
    elif (APP_DIR / "templates").exists():
        BUNDLE_DIR = APP_DIR
    else:
        BUNDLE_DIR = APP_DIR
else:
    APP_DIR = Path(__file__).resolve().parent
    BUNDLE_DIR = APP_DIR

BASE_DIR = BUNDLE_DIR
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import webview
from app.utils.dwm import apply_dwm_titlebar_theme
from app.utils.logging_setup import setup_logging
from app.services.connection_manager import ConnectionManager
from app.services.history import get_history_service
from app.services.settings_store import (
    DATA_DIR,
    _load_settings_file,
    _save_settings_file,
)
from app.desktop.clipboard import (
    _native_set_clipboard,
    _native_get_clipboard,
)
from app.desktop.windows import (
    QueryHistorySubwindowApi,
    SettingsSubwindowApi,
    ProfilerSubwindowApi,
    EventListenerSubwindowApi,
    open_bravo_window as _desktop_open_bravo_window,
)
from app.api.connections_api import ConnectionsApiMixin
from app.api.settings_api import SettingsApiMixin
from app.api.table_editor_api import TableEditorApiMixin
from app.api.designer_api import DesignerApiMixin
from app.api.profiler_api import ProfilerApiMixin
from app.api.metadata_api import MetadataApiMixin, MainMetadataApiMixin
from app.bravo.api import BravoApiMixin
from app.api.query_api import QueryApiMixin
from app.api.history_api import HistoryApiMixin
from app.api.session_api import SessionApiMixin

logger = logging.getLogger("luobtool.main")
connection_manager = ConnectionManager()
_OWNER_SESSION = "desktop_user"

# -------------------------------------------------------------------------
# BravoApi & MainApi
# -------------------------------------------------------------------------


class BravoApi(
    SettingsApiMixin,
    TableEditorApiMixin,
    DesignerApiMixin,
    MetadataApiMixin,
    ConnectionsApiMixin,
    ProfilerApiMixin,
    BravoApiMixin,
):
    def __init__(self, cm: ConnectionManager, owner_session_id: str = None, initial_context: dict = None, main_api=None):
        self.cm = cm
        self.owner_session_id = owner_session_id or f"bravo_user_{uuid.uuid4().hex[:8]}"
        self.initial_context = initial_context or {}
        self._bravo_sessions = {}
        self._window = None
        self._profiler_windows = []
        self._event_listener_windows = []
        self._main_api = main_api
        self._current_titlebar_theme = None

    def set_window(self, win):
        self._window = win


class MainApi(
    QueryApiMixin,
    HistoryApiMixin,
    SessionApiMixin,
    MainMetadataApiMixin,
    BravoApi,
):
    def __init__(self, cm: ConnectionManager = connection_manager):
        super().__init__(cm, owner_session_id="desktop_user")
        self._window = None
        self._bravo_windows = []
        self._profiler_windows = []
        self._history_window = None
        self._on_ready_callback = None

    def set_window(self, win):
        super().set_window(win)
        self._window = win

    def notify_app_ready(self):
        """Called by frontend once DOM, Monaco, Explorer and Theme are fully loaded."""
        if hasattr(self, '_on_ready_callback') and callable(self._on_ready_callback):
            self._on_ready_callback()
        return {"success": True}

    def open_bravo_window(self, conn_id=None, conn_name=None, database=None, db_type=None, schema=None):
        return _desktop_open_bravo_window(self, conn_id=conn_id, conn_name=conn_name, database=database, db_type=db_type, schema=schema)

    def get_code_styles(self):
        try:
            from app.routes.styles import _load_styles_file
            return _load_styles_file()
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def save_code_styles(self, payload):
        try:
            from app.routes.styles import _save_styles_file
            if not isinstance(payload, dict):
                return {"success": False, "error": "payload must be an object"}
            ok = _save_styles_file(payload)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def reset_code_styles(self):
        try:
            from app.routes.styles import _get_default_styles_data, _save_styles_file
            defaults = _get_default_styles_data()
            _save_styles_file(defaults)
            return {"success": True, **defaults}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache_dir = DATA_DIR / ".webview_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    settings = _load_settings_file()
    log_cfg = settings.get("logging", {}) if isinstance(settings, dict) else {}
    log_level = log_cfg.get("level", "INFO")
    max_mb = int(log_cfg.get("maxFileSizeMb", 2))
    max_files = int(log_cfg.get("maxFiles", 5))
    setup_logging(
        log_dir=DATA_DIR / "logs",
        level_name=log_level,
        max_bytes=max_mb * 1024 * 1024,
        backup_count=max_files,
        enable_console=True
    )

    index_html = (BASE_DIR / "templates" / "index.html").resolve().as_uri()
    splash_html = (BASE_DIR / "templates" / "splash.html").resolve().as_uri()
    main_api = MainApi(connection_manager)
    cur_theme = settings.get("appearance", {}).get("theme") or settings.get("theme", "dark")
    bg_color = "#ffffff" if cur_theme in ["light", "win-nt", "win-xp"] else "#1e1e1e"

    import ctypes
    try:
        user32 = ctypes.windll.user32
        sw = user32.GetSystemMetrics(0)
        sh = user32.GetSystemMetrics(1)
    except Exception:
        sw, sh = 1920, 1080

    splash_w, splash_h = 800, 500
    splash_x = max(0, (sw - splash_w) // 2)
    splash_y = max(0, (sh - splash_h) // 2)

    splash_win = webview.create_window(
        title="luoBTool IDE",
        url=splash_html,
        width=splash_w,
        height=splash_h,
        x=splash_x,
        y=splash_y,
        frameless=True,
        easy_drag=True,
        resizable=False,
        background_color="#071324",
        on_top=True
    )

    window = webview.create_window(
        title="luoBTool IDE",
        url=index_html,
        js_api=main_api,
        width=1400,
        height=900,
        min_size=(900, 600),
        hidden=True,
        background_color=bg_color,
        text_select=True
    )
    main_api.set_window(window)

    splash_min_timer_done = False
    frontend_ready = False
    splash_closed = False

    def maybe_transition():
        nonlocal splash_closed
        if splash_closed:
            return
        if splash_min_timer_done and frontend_ready:
            splash_closed = True
            try:
                window.show()
            except Exception:
                pass

            def _sync_titlebar():
                try:
                    main_api.apply_titlebar_theme(cur_theme)
                except Exception:
                    pass
                try:
                    apply_dwm_titlebar_theme(window, bg=cur_theme, title="luoBTool IDE")
                except Exception:
                    pass

            _sync_titlebar()
            import threading
            threading.Timer(0.1, _sync_titlebar).start()
            threading.Timer(0.35, _sync_titlebar).start()
            threading.Timer(0.7, _sync_titlebar).start()

            try:
                splash_win.hide()
            except Exception:
                pass
            def _destroy_splash():
                try:
                    splash_win.destroy()
                except Exception:
                    pass
                _sync_titlebar()
            threading.Timer(0.5, _destroy_splash).start()

    def on_min_splash_timer():
        nonlocal splash_min_timer_done
        splash_min_timer_done = True
        maybe_transition()

    timer_started = False
    def start_min_timer():
        nonlocal timer_started
        if timer_started:
            return
        timer_started = True
        import threading
        threading.Timer(2.0, on_min_splash_timer).start()

    def on_splash_loaded():
        # Hiển thị Splash screen tối thiểu đúng 2.0 giây theo yêu cầu
        start_min_timer()

    splash_win.events.loaded += on_splash_loaded
    # Đảm bảo bộ đếm tối thiểu 2.0s luôn kích hoạt kể cả khi sự kiện loaded của webview diễn ra cực nhanh
    import threading
    threading.Timer(0.1, start_min_timer).start()

    def on_app_ready():
        nonlocal frontend_ready
        frontend_ready = True
        maybe_transition()

    main_api._on_ready_callback = on_app_ready

    def on_main_loaded():
        try:
            apply_dwm_titlebar_theme(window, bg=cur_theme, title="luoBTool IDE")
            window.evaluate_js(
                f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', true); }} "
                f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
            )
        except Exception:
            pass

    window.events.loaded += on_main_loaded

    def on_main_closed():
        try:
            closed = connection_manager.close_all_sessions()
            logger.info("Cleaned up %d connection(s) on main window close", closed)
        except Exception as ex:
            logger.warning("Error cleaning up connections on main window close: %s", ex)

    window.events.closed += on_main_closed

    # Safety fallback timer: sau 10.0s đảm bảo chuyển tiếp nếu frontend gặp lỗi nghiêm trọng không gọi về được
    def on_fallback():
        nonlocal splash_min_timer_done, frontend_ready
        splash_min_timer_done = True
        frontend_ready = True
        maybe_transition()

    import threading
    threading.Timer(10.0, on_fallback).start()

    print(f"[App] Starting Desktop pywebview with active theme: {cur_theme}")
    webview.start(gui="edgechromium", storage_path=str(cache_dir.resolve()), debug=False)


if __name__ == "__main__":
    main()
