# -*- coding: utf-8 -*-
"""
WebView2 Companion Window Host for Google Sheets.
Manages pywebview instances for Google Sheets, lifecycle hooks, focus, and system browser fallback.
"""

import sys
import logging
import threading
import webbrowser
from typing import Dict, Any, Optional

logger = logging.getLogger("app.services.google_sheets.webview_host")


def _get_current_titlebar_theme(parent_api=None) -> Dict[str, Any]:
    """Retrieve active titlebar colors and dark/light mode from IDE settings."""
    try:
        from app.desktop.windows import _load_settings_file
        from app.utils.dwm import THEME_TITLEBAR_PRESETS

        t = getattr(parent_api, "_current_titlebar_theme", None)
        if not t and hasattr(parent_api, "_main_api"):
            t = getattr(parent_api._main_api, "_current_titlebar_theme", None)
        if t and isinstance(t, dict) and t.get("bg"):
            return t

        settings = _load_settings_file()
        cur_theme = settings.get("appearance", {}).get("theme") or settings.get("theme", "dark")
        if cur_theme in THEME_TITLEBAR_PRESETS:
            return THEME_TITLEBAR_PRESETS[cur_theme]

        is_dark = cur_theme not in ("light", "win-nt", "win-xp") and "light" not in str(cur_theme).lower()
        return {"bg": cur_theme, "is_dark": is_dark}
    except Exception as exc:
        logger.debug("[Host] Failed to detect current theme, using default: %s", exc)
        return {"bg": "#202228", "text": "#c7cfcf", "border": "#3c3f41", "is_dark": True}


def _apply_window_icon(win):
    """Set window icon to logo.ico on Windows to replace default Python icon."""
    if sys.platform != "win32":
        return
    try:
        from pathlib import Path
        base_dir = Path(__file__).resolve().parent.parent.parent.parent
        candidate_icons = [
            base_dir / "logo.ico",
            base_dir / "_internal" / "logo.ico",
        ]
        ico_file = next((f for f in candidate_icons if f.exists()), None)
        if not ico_file:
            return

        # 1. If WinForms Form native instance is available
        native_form = getattr(win, "native", None)
        if native_form:
            import System.Drawing
            native_form.Icon = System.Drawing.Icon(str(ico_file))
            return

        # 2. Otherwise via Win32 SendMessage WM_SETICON
        from app.utils.dwm import get_window_hwnd
        hwnd = get_window_hwnd(win)
        if hwnd:
            import ctypes
            user32 = ctypes.windll.user32
            IMAGE_ICON = 1
            LR_LOADFROMFILE = 0x00000010
            LR_DEFAULTSIZE = 0x00000040
            h_icon = user32.LoadImageW(0, str(ico_file), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
            if h_icon:
                WM_SETICON = 0x0080
                ICON_SMALL = 0
                ICON_BIG = 1
                user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, h_icon)
                user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, h_icon)
    except Exception as exc:
        logger.debug("[Host] Could not apply window icon: %s", exc)


class GoogleSheetsWindowManager:
    """Manages active Google Sheets companion windows."""

    def __init__(self):
        self._lock = threading.Lock()
        self._windows: Dict[str, Any] = {}

    def is_sheet_open(self, sheet_id: str) -> bool:
        """Check if a window for this sheet is currently open."""
        with self._lock:
            win = self._windows.get(sheet_id)
            if not win:
                return False
            # Check if pywebview window is still valid
            try:
                # If window object is destroyed or has no native handle, it's closed
                return getattr(win, "shown", False) or getattr(win, "native", None) is not None
            except Exception:
                return False

    def get_open_windows(self) -> list:
        """Return list of active pywebview companion window instances."""
        with self._lock:
            return list(self._windows.values())

    def open_sheet_window(
        self,
        sheet_id: str,
        title: str,
        url: str,
        width: int = 1280,
        height: int = 800,
        parent_api: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        Open or focus a companion window for the given Google Sheet.
        """
        import webview

        with self._lock:
            # Check if already open
            existing_win = self._windows.get(sheet_id)
            if existing_win:
                try:
                    logger.info("[Host] Sheet '%s' already open, restoring and focusing...", title)
                    if hasattr(existing_win, "restore"):
                        existing_win.restore()
                    if hasattr(existing_win, "focus"):
                        existing_win.focus()
                    return {"success": True, "action": "focused", "sheetId": sheet_id}
                except Exception as exc:
                    logger.warning("[Host] Failed to focus existing window, recreating: %s", exc)
                    self._windows.pop(sheet_id, None)

            # Create new companion window
            win_title = f"📊 {title} — Google Sheets"
            logger.info("[Host] Creating new WebView2 companion window: %s -> %s", win_title, url)

            try:
                sheet_win = webview.create_window(
                    title=win_title,
                    url=url,
                    width=width,
                    height=height,
                    min_size=(800, 500),
                    text_select=True,
                )

                self._windows[sheet_id] = sheet_win

                # Cleanup hook on close
                def _on_closed():
                    logger.info("[Host] Companion window closed for sheet: %s", sheet_id)
                    with self._lock:
                        self._windows.pop(sheet_id, None)
                    if parent_api and hasattr(parent_api, "notify_sheet_closed"):
                        try:
                            parent_api.notify_sheet_closed(sheet_id)
                        except Exception:
                            pass

                def _on_shown():
                    # Apply current IDE theme to titlebar via DWM
                    try:
                        from app.utils.dwm import apply_dwm_titlebar_theme
                        theme_data = _get_current_titlebar_theme(parent_api)
                        apply_dwm_titlebar_theme(
                            sheet_win,
                            bg=theme_data.get("bg"),
                            text=theme_data.get("text"),
                            border=theme_data.get("border"),
                            is_dark=theme_data.get("is_dark"),
                            title=win_title
                        )
                    except Exception as dwm_err:
                        logger.debug("[Host] DWM theming note: %s", dwm_err)

                    # Replace default python icon with IDE logo icon
                    try:
                        _apply_window_icon(sheet_win)
                    except Exception as icon_err:
                        logger.debug("[Host] Window icon note: %s", icon_err)

                sheet_win.events.closed += _on_closed
                sheet_win.events.shown += _on_shown

                return {
                    "success": True,
                    "action": "opened",
                    "sheetId": sheet_id,
                    "title": title,
                    "url": url
                }

            except Exception as exc:
                logger.exception("[Host] Failed to create WebView2 window for sheet %s: %s", sheet_id, exc)
                return {"success": False, "error": str(exc), "sheetId": sheet_id}

    def close_sheet_window(self, sheet_id: str) -> bool:
        """Close an open companion window."""
        with self._lock:
            win = self._windows.pop(sheet_id, None)
            if win:
                try:
                    win.destroy()
                    return True
                except Exception as exc:
                    logger.warning("[Host] Error closing window for sheet %s: %s", sheet_id, exc)
        return False

    def close_all(self) -> None:
        """Close all open Google Sheets windows."""
        with self._lock:
            sheet_ids = list(self._windows.keys())
            for sid in sheet_ids:
                win = self._windows.pop(sid, None)
                if win:
                    try:
                        win.destroy()
                    except Exception:
                        pass

    def get_open_sheet_ids(self) -> list:
        """Return list of sheet IDs that currently have an open window."""
        with self._lock:
            return list(self._windows.keys())

    @staticmethod
    def open_in_browser(url: str) -> Dict[str, Any]:
        """System browser fallback."""
        try:
            logger.info("[Host] Opening in system browser: %s", url)
            opened = webbrowser.open(url, new=2)
            return {"success": opened, "url": url}
        except Exception as exc:
            logger.error("[Host] Failed to open system browser: %s", exc)
            return {"success": False, "error": str(exc)}


_GLOBAL_WINDOW_MANAGER: Optional[GoogleSheetsWindowManager] = None


def get_window_manager() -> GoogleSheetsWindowManager:
    """Singleton getter for GoogleSheetsWindowManager."""
    global _GLOBAL_WINDOW_MANAGER
    if _GLOBAL_WINDOW_MANAGER is None:
        _GLOBAL_WINDOW_MANAGER = GoogleSheetsWindowManager()
    return _GLOBAL_WINDOW_MANAGER
