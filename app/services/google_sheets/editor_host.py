# -*- coding: utf-8 -*-
"""
Google Sheets Native WebView2 Editor Host for Pane 3.
Provides in-place editing of Google Sheets spreadsheets using the official
Google Sheets '/edit' interface embedded directly as a native WinForms child control.
Thread-safe, state-managed, and sharing authentication cookies with the main IDE.
"""

import logging
import threading
from typing import Dict, Any, Optional
from pathlib import Path

from app.services.settings_store import DATA_DIR
from app.services.google_sheets.url_parser import parse_google_sheets_url

logger = logging.getLogger("app.services.google_sheets.editor_host")


class EditorHostState:
    INITIALIZING = "initializing"
    LOADING = "loading"
    READY = "ready"
    AUTH_REQUIRED = "auth_required"
    READ_ONLY = "read_only"
    ACCESS_DENIED = "access_denied"
    NETWORK_ERROR = "network_error"
    CLOSING = "closing"
    DISPOSED = "disposed"


def normalize_sheet_edit_url(raw_url: str) -> str:
    """
    Normalizes a Google Sheets URL into the official /edit URL format.
    Preserves gid (worksheet ID) if available.
    """
    if not raw_url:
        return ""
    parsed = parse_google_sheets_url(raw_url)
    sid = parsed.get("spreadsheet_id") or parsed.get("spreadsheetId")
    if sid:
        gid = parsed.get("gid")
        edit_url = f"https://docs.google.com/spreadsheets/d/{sid}/edit"
        if gid:
            edit_url += f"#gid={gid}"
        return edit_url
    return raw_url


def _invoke_on_form(form: Any, func: Any) -> None:
    """
    Executes a callback on the Windows Forms UI STA thread safely.
    Handles System.Action / MethodInvoker delegate marshaling for pythonnet.
    """
    if form is None or getattr(form, "IsDisposed", False):
        return
    if hasattr(form, "InvokeRequired") and form.InvokeRequired:
        try:
            import clr
            import System
            form.Invoke(System.Action(func))
        except Exception:
            try:
                import clr
                clr.AddReference("System.Windows.Forms")
                from System.Windows.Forms import MethodInvoker
                form.Invoke(MethodInvoker(func))
            except Exception:
                func()
    else:
        func()


class GoogleSheetsEditorHost:
    """
    Manages a native Microsoft.Web.WebView2.WinForms.WebView2 control embedded
    inside pywebview's WinForms Form to host Google Sheets in-place in Pane 3.
    """

    def __init__(self, window: Any = None, cache_dir: Optional[str] = None):
        self._window = window
        self._cache_dir = cache_dir or str((DATA_DIR / ".webview_cache").resolve())
        self._form = getattr(window, "native", None) if window else None
        self._control = None
        self._status = EditorHostState.INITIALIZING
        self._is_initialized = False
        self._is_ready = False
        self._current_url: Optional[str] = None
        self._bounds = {"x": 0, "y": 0, "width": 0, "height": 0}
        self._visible = False
        self._last_error: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def is_attached(self) -> bool:
        return self._control is not None

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    @property
    def status(self) -> str:
        return self._status

    @property
    def current_url(self) -> Optional[str]:
        return self._current_url

    def set_window(self, window: Any):
        """Bind or update the parent pywebview window."""
        self._window = window
        if window:
            self._form = getattr(window, "native", None)

    def initialize(self, window: Any = None) -> Dict[str, Any]:
        """
        Initializes the native WebView2 control on the WinForms Form STA Thread.
        Uses shared UserDataFolder (cache_dir) to share Google session cookies.
        """
        with self._lock:
            if window:
                self.set_window(window)

            if self._control is not None:
                return {
                    "success": True,
                    "status": self._status,
                    "is_ready": self._is_ready,
                    "current_url": self._current_url
                }

            self._status = EditorHostState.INITIALIZING
            self._last_error = None

            try:
                import webview.platforms.edgechromium as ec
                import webview.platforms.winforms as wf

                form = getattr(self._window, "native", None) or self._form
                if not form:
                    self._status = EditorHostState.NETWORK_ERROR
                    self._last_error = "Native WinForms Form not found on pywebview window"
                    logger.error("[EditorHost] %s", self._last_error)
                    return {"success": False, "error": self._last_error, "status": self._status}

                # Ensure cache directory exists
                Path(self._cache_dir).mkdir(parents=True, exist_ok=True)

                ctl = None
                ui_error = None

                def _setup_ctl_on_ui():
                    nonlocal ctl, ui_error
                    try:
                        ctl = ec.WebView2()
                        ctl.Visible = False

                        def _on_init_completed(sender, args):
                            with self._lock:
                                if args.IsSuccess:
                                    self._is_ready = True
                                    self._status = EditorHostState.READY if self._current_url else EditorHostState.INITIALIZING
                                    logger.info("[EditorHost] CoreWebView2 initialization completed successfully.")

                                    # Attach navigation event listeners
                                    try:
                                        core = ctl.CoreWebView2
                                        if core is not None:
                                            def _on_nav_starting(s, nav_args):
                                                self._status = EditorHostState.LOADING
                                                logger.debug("[EditorHost] Navigation starting: %s", getattr(nav_args, "Uri", ""))

                                            def _on_nav_completed(s, nav_args):
                                                if getattr(nav_args, "IsSuccess", False):
                                                    current_uri = str(getattr(core, "Source", "") or "")
                                                    if "accounts.google.com" in current_uri:
                                                        self._status = EditorHostState.AUTH_REQUIRED
                                                    else:
                                                        self._status = EditorHostState.READY
                                                    logger.info("[EditorHost] Navigation completed (%s): %s", self._status, current_uri)
                                                else:
                                                    self._status = EditorHostState.NETWORK_ERROR
                                                    logger.warning("[EditorHost] Navigation failed with error status.")

                                            def _on_new_window_requested(s, window_args):
                                                uri = str(getattr(window_args, "Uri", "") or "")
                                                # Allow Google auth or Sheets internal popups to process normally
                                                if "accounts.google.com" in uri or "docs.google.com" in uri:
                                                    logger.info("[EditorHost] Permitted Google auth/internal popup: %s", uri)
                                                    return
                                                # Intercept and redirect external third-party links to default system browser
                                                try:
                                                    window_args.Handled = True
                                                    import webbrowser
                                                    webbrowser.open(uri)
                                                    logger.info("[EditorHost] Redirected external link to system browser: %s", uri)
                                                except Exception as open_err:
                                                    logger.warning("[EditorHost] Failed to redirect popup to system browser: %s", open_err)

                                            core.NavigationStarting += _on_nav_starting
                                            core.NavigationCompleted += _on_nav_completed
                                            core.NewWindowRequested += _on_new_window_requested
                                    except Exception as hook_err:
                                        logger.debug("[EditorHost] Note on event hooking: %s", hook_err)

                                    # If a pending URL was queued during init, navigate now
                                    if self._current_url:
                                        try:
                                            ctl.CoreWebView2.Navigate(self._current_url)
                                        except Exception as nav_err:
                                            logger.warning("[EditorHost] Post-init navigate error: %s", nav_err)
                                else:
                                    self._is_ready = False
                                    self._status = EditorHostState.NETWORK_ERROR
                                    self._last_error = str(args.InitializationException)
                                    logger.error("[EditorHost] CoreWebView2 init failed: %s", self._last_error)

                        ctl.CoreWebView2InitializationCompleted += _on_init_completed

                        # Thread-safe add to Form.Controls
                        if self._bounds["width"] > 0 and self._bounds["height"] > 0:
                            ctl.Location = wf.Point(self._bounds["x"], self._bounds["y"])
                            ctl.Size = wf.Size(self._bounds["width"], self._bounds["height"])
                        form.Controls.Add(ctl)
                        ctl.BringToFront()

                        # Ensure HWND handle is created
                        if hasattr(ctl, "IsHandleCreated") and not ctl.IsHandleCreated:
                            _ = ctl.Handle

                        # Check for shared CoreWebView2Environment from parent pywebview window
                        main_wv = getattr(form, "webview", None) or getattr(getattr(form, "browser", None), "webview", None)
                        shared_env = None
                        if main_wv is not None:
                            main_core = getattr(main_wv, "CoreWebView2", None)
                            if main_core is not None:
                                shared_env = getattr(main_core, "Environment", None)

                        if shared_env is not None:
                            ctl.CreationProperties = None
                            logger.info("[EditorHost] Initializing with shared CoreWebView2Environment from pywebview.")
                            ctl.EnsureCoreWebView2Async(shared_env)
                        else:
                            if main_wv is not None and getattr(main_wv, "CreationProperties", None) is not None:
                                ctl.CreationProperties = main_wv.CreationProperties
                                logger.info("[EditorHost] Initializing with inherited CreationProperties from parent WebView2.")
                            else:
                                pywebview_cache = getattr(getattr(form, "browser", None), "user_data_folder", None) or getattr(wf, "cache_dir", None)
                                target_cache = pywebview_cache or self._cache_dir
                                props = ec.CoreWebView2CreationProperties()
                                props.UserDataFolder = str(target_cache)
                                props.set_IsInPrivateModeEnabled(False)
                                props.AdditionalBrowserArguments = "--disable-features=ElasticOverscroll"
                                ctl.CreationProperties = props
                                logger.info("[EditorHost] Initializing with fallback CreationProperties at: %s", target_cache)
                            ctl.EnsureCoreWebView2Async(None)

                    except Exception as ex:
                        ui_error = ex
                        logger.exception("[EditorHost] Error in _setup_ctl_on_ui: %s", ex)

                _invoke_on_form(form, _setup_ctl_on_ui)

                if ui_error:
                    self._status = EditorHostState.NETWORK_ERROR
                    self._last_error = str(ui_error)
                    return {"success": False, "error": str(ui_error), "status": self._status}

                self._control = ctl
                self._form = form
                self._is_initialized = True

                return {"success": True, "status": self._status, "initialized": True}

            except Exception as exc:
                self._status = EditorHostState.NETWORK_ERROR
                self._last_error = str(exc)
                logger.exception("[EditorHost] Failed to initialize native control: %s", exc)
                return {"success": False, "error": str(exc), "status": self._status}

    def navigate(self, url: str) -> Dict[str, Any]:
        """
        Navigates the editor control to Google Sheets /edit URL.
        Normalizes the URL and handles lazy initialization if not already attached.
        """
        if not url:
            return {"success": False, "error": "Empty URL"}

        target_url = normalize_sheet_edit_url(url)
        self._current_url = target_url
        self._status = EditorHostState.LOADING

        if self._control is None:
            init_res = self.initialize()
            if not init_res.get("success"):
                return init_res

        try:
            import webview.platforms.edgechromium as ec
            import webview.platforms.winforms as wf

            def _do_nav():
                if self._control and not getattr(self._control, "IsDisposed", False):
                    if getattr(self._control, "CoreWebView2", None) is not None:
                        self._control.CoreWebView2.Navigate(target_url)
                    else:
                        self._control.Source = ec.Uri(target_url)

            _invoke_on_form(self._form, _do_nav)

            return {"success": True, "url": target_url, "status": self._status}

        except Exception as exc:
            self._status = EditorHostState.NETWORK_ERROR
            self._last_error = str(exc)
            logger.exception("[EditorHost] Navigation error: %s", exc)
            return {"success": False, "error": str(exc), "status": self._status}

    def set_bounds(self, x: int, y: int, width: int, height: int, visible: bool = True, dpr: Optional[float] = None) -> Dict[str, Any]:
        """
        Synchronizes native WebView2 bounds with DOM Pane 3 coordinates.
        Converts logical DOM pixels (CSS) to physical WinForms device pixels using DPI scaling.
        (x, y, width, height) are CSS pixels from getBoundingClientRect().
        """
        # Determine scale factor (per-window DPI / 96 or devicePixelRatio from DOM)
        scale = getattr(self._form, "_scale", None) or dpr
        if scale is None or scale <= 0:
            try:
                import ctypes
                hwnd = getattr(self._form, "Handle", None)
                hwnd_val = hwnd.ToInt32() if hwnd is not None else 0
                if hwnd_val:
                    scale = ctypes.windll.user32.GetDpiForWindow(hwnd_val) / 96.0
                else:
                    scale = 1.0
            except Exception:
                scale = 1.0

        phys_x = int(round(float(x) * float(scale)))
        phys_y = int(round(float(y) * float(scale)))
        phys_w = int(round(float(width) * float(scale)))
        phys_h = int(round(float(height) * float(scale)))

        self._bounds = {"x": phys_x, "y": phys_y, "width": phys_w, "height": phys_h}
        self._visible = bool(visible)

        if self._control is None:
            return {"success": False, "error": "Control not initialized"}

        try:
            import webview.platforms.winforms as wf

            def _update_geom():
                if not self._control or getattr(self._control, "IsDisposed", False):
                    return

                self._control.Location = wf.Point(phys_x, phys_y)
                self._control.Size = wf.Size(max(0, phys_w), max(0, phys_h))
                self._control.Visible = bool(visible and phys_w > 10 and phys_h > 10)
                if self._control.Visible:
                    self._control.BringToFront()

            _invoke_on_form(self._form, _update_geom)
            logger.debug(
                "[EditorHost] set_bounds: css=(%s, %s, %s, %s) -> phys=(%s, %s, %s, %s) scale=%.2f",
                x, y, width, height, phys_x, phys_y, phys_w, phys_h, scale
            )

            return {"success": True, "bounds": self._bounds, "visible": self._visible, "scale": scale}

        except Exception as exc:
            logger.exception("[EditorHost] Set bounds error: %s", exc)
            return {"success": False, "error": str(exc)}

    def set_visible(self, visible: bool) -> Dict[str, Any]:
        """Shows or hides the native overlay control to prevent Airspace overlap."""
        self._visible = bool(visible)
        if self._control is None:
            return {"success": True, "visible": self._visible}

        try:
            import webview.platforms.winforms as wf

            def _do_vis():
                if self._control and not getattr(self._control, "IsDisposed", False):
                    self._control.Visible = self._visible
                    if self._visible:
                        self._control.BringToFront()

            _invoke_on_form(self._form, _do_vis)

            return {"success": True, "visible": self._visible}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_state(self) -> Dict[str, Any]:
        """Returns the current state dictionary of the Google Sheets Editor Host."""
        return {
            "status": self._status,
            "url": self._current_url,
            "visible": self._visible,
            "is_ready": self._is_ready,
            "is_attached": self.is_attached,
            "bounds": self._bounds,
            "error": self._last_error
        }

    def dispose(self) -> Dict[str, Any]:
        """Disposes and detaches the native WebView2 control cleanly."""
        with self._lock:
            if self._control is None:
                self._status = EditorHostState.DISPOSED
                return {"success": True, "status": "already_disposed"}

            self._status = EditorHostState.CLOSING

            try:
                import webview.platforms.winforms as wf

                ctl = self._control
                form = self._form
                self._control = None
                self._is_initialized = False
                self._is_ready = False
                self._visible = False

                def _do_dispose():
                    try:
                        if form is not None and not getattr(form, "IsDisposed", False):
                            form.Controls.Remove(ctl)
                        if ctl is not None and not getattr(ctl, "IsDisposed", False):
                            ctl.Dispose()
                    except Exception as ex:
                        logger.warning("[EditorHost] Error during dispose: %s", ex)

                _invoke_on_form(form, _do_dispose)

                self._status = EditorHostState.DISPOSED
                return {"success": True, "status": self._status}

            except Exception as exc:
                self._status = EditorHostState.DISPOSED
                self._last_error = str(exc)
                logger.exception("[EditorHost] Failed to dispose control: %s", exc)
                return {"success": False, "error": str(exc)}
