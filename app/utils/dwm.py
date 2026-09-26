"""
app/utils/dwm.py: Windows Desktop Window Manager (DWM) Titlebar Theming Bridge.
Đồng bộ màu sắc thanh tiêu đề (Titlebar/Taskbar) theo Theme IDE bằng DWM Win32 API.
Hỗ trợ tương thích chuẩn xác cho cả Windows 10 và Windows 11.
"""

import ctypes
from ctypes import wintypes
import os
import re
import sys
import logging

logger = logging.getLogger("app.utils.dwm")

# Win32 & DWM Constants
DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19
DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_BORDER_COLOR = 34
DWMWA_CAPTION_COLOR = 35
DWMWA_TEXT_COLOR = 36

# SetWindowPos flags
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_FRAMECHANGED = 0x0020

# Bảng màu mặc định chuẩn theo từng theme cho titlebar
THEME_TITLEBAR_PRESETS = {
    "dark": {
        "bg": "#202228",
        "text": "#c7cfcf",
        "border": "#3c3f41",
        "is_dark": True
    },
    "light": {
        "bg": "#dcdcdc",
        "text": "#2b2b2b",
        "border": "#cccccc",
        "is_dark": False
    },
    "monokai": {
        "bg": "#1E1F1C",
        "text": "#F8F8F2",
        "border": "#3E3D32",
        "is_dark": True
    },
    "nord": {
        "bg": "#242933",
        "text": "#ECEFF4",
        "border": "#4C566A",
        "is_dark": True
    },
    "win-nt": {
        "bg": "#000080",      # Classic Windows NT Navy Blue
        "text": "#FFFFFF",
        "border": "#777777",
        "is_dark": True
    },
    "win-xp": {
        "bg": "#0055ea",      # Classic Windows XP Luna Blue
        "text": "#FFFFFF",
        "border": "#2157d7",
        "is_dark": True
    }
}


def hex_to_colorref(color_str: str) -> int:
    """Chuyển đổi '#RRGGBB', '#RGB' hoặc 'rgb(r, g, b)' sang Win32 COLORREF (0x00BBGGRR)."""
    if not color_str:
        return 0
    s = str(color_str).strip()
    # Hỗ trợ dạng rgb(r, g, b)
    if s.lower().startswith("rgb"):
        m = re.search(r"(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", s)
        if m:
            r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return (b << 16) | (g << 8) | r
    # Hỗ trợ hex #RGB hoặc #RRGGBB
    clean = s.lstrip("#")
    if len(clean) == 3:
        clean = "".join([c * 2 for c in clean])
    if len(clean) == 6:
        try:
            r = int(clean[0:2], 16)
            g = int(clean[2:4], 16)
            b = int(clean[4:6], 16)
            return (b << 16) | (g << 8) | r
        except ValueError:
            pass
    return 0


def is_dark_color(color_str: str) -> bool:
    """Tính độ sáng tương đối (Relative Luminance) để xác định màu nền là sáng hay tối."""
    if not color_str:
        return True
    s = str(color_str).strip()
    r, g, b = 255, 255, 255
    if s.lower().startswith("rgb"):
        m = re.search(r"(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", s)
        if m:
            r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        clean = s.lstrip("#")
        if len(clean) == 3:
            clean = "".join([c * 2 for c in clean])
        if len(clean) == 6:
            try:
                r = int(clean[0:2], 16)
                g = int(clean[2:4], 16)
                b = int(clean[4:6], 16)
            except ValueError:
                r, g, b = 255, 255, 255
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return luminance < 0.5


def get_windows_build() -> int:
    """Lấy số hiệu build của Windows. Trả về 0 nếu không phải Windows."""
    if sys.platform != "win32":
        return 0
    try:
        return sys.getwindowsversion().build
    except Exception:
        return 0


def is_windows_11_or_higher() -> bool:
    """Kiểm tra hệ điều hành có phải Windows 11 trở lên (Build >= 22000) hay không."""
    return get_windows_build() >= 22000


def get_window_hwnd(window_or_hwnd, title: str = None) -> int | None:
    """
    Xác định HWND của cửa sổ pywebview hoặc số HWND được truyền vào.
    Hỗ trợ cả window.native.Handle (WinForms/EdgeChromium) và FindWindowW.
    """
    if sys.platform != "win32":
        return None

    if isinstance(window_or_hwnd, int) and window_or_hwnd > 0:
        return window_or_hwnd

    # 1. Trích xuất từ pywebview Window instance thông qua thuộc tính .native
    if window_or_hwnd is not None:
        try:
            native = getattr(window_or_hwnd, "native", None)
            if native:
                handle = getattr(native, "Handle", None)
                if handle is not None:
                    if hasattr(handle, "ToInt64"):
                        return int(handle.ToInt64())
                    return int(handle)
        except Exception as exc:
            logger.debug(f"[DWM] Could not extract hwnd from native: {exc}")

        # Lấy title từ window nếu chưa được truyền
        if not title and hasattr(window_or_hwnd, "title") and window_or_hwnd.title:
            title = window_or_hwnd.title

    # 2. Tìm qua FindWindowW theo Window Title
    if title:
        try:
            hwnd = ctypes.windll.user32.FindWindowW(None, title)
            if hwnd:
                return hwnd
        except Exception as exc:
            logger.debug(f"[DWM] FindWindowW failed for title '{title}': {exc}")

    # 3. EnumWindows tìm kiếm cửa sổ thuộc tiến trình hiện tại nếu có title tương đồng
    if title:
        try:
            user32 = ctypes.windll.user32
            current_pid = os.getpid()
            found_hwnd = None

            @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
            def enum_proc(h, _):
                nonlocal found_hwnd
                lp_pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(h, ctypes.byref(lp_pid))
                if lp_pid.value == current_pid:
                    length = user32.GetWindowTextLengthW(h)
                    if length > 0:
                        buff = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(h, buff, length + 1)
                        if title in buff.value or buff.value in title:
                            found_hwnd = h
                            return False  # Dừng duyệt
                return True

            user32.EnumWindows(enum_proc, 0)
            if found_hwnd:
                return found_hwnd
        except Exception as exc:
            logger.debug(f"[DWM] EnumWindows search failed: {exc}")

    return None


def apply_dwm_titlebar_theme(
    window_or_hwnd,
    bg: str = None,
    text: str = None,
    border: str = None,
    is_dark: bool = None,
    title: str = None
) -> bool:
    """
    Áp dụng màu sắc cho thanh tiêu đề của cửa sổ Windows thông qua DWM API.

    Xử lý phân nhánh kỹ thuật:
    - Windows 11 (Build >= 22000):
        + DWMWA_USE_IMMERSIVE_DARK_MODE (20): Đảo màu nút caption (trắng/đen).
        + DWMWA_CAPTION_COLOR (35): Đổi màu nền thanh tiêu đề theo bg.
        + DWMWA_TEXT_COLOR (36): Đổi màu chữ tiêu đề theo text.
        + DWMWA_BORDER_COLOR (34): Đổi màu viền cửa sổ theo border.
    - Windows 10 (Build < 22000):
        + Bỏ qua 34, 35, 36 (tránh lỗi 0x80070057 E_INVALIDARG).
        + Áp dụng DWMWA_USE_IMMERSIVE_DARK_MODE (20 hoặc 19) để chuyển đổi giữa
          native Dark Titlebar và Light Titlebar hệ thống.
    - Cả Win 10 & Win 11:
        + Gọi SetWindowPos với SWP_FRAMECHANGED (0x0020) để ép DWM vẽ lại lập tức.
    """
    if sys.platform != "win32":
        return False

    # Nếu bg là tên một theme trong bảng presets, tự động nạp các thông số màu
    if bg in THEME_TITLEBAR_PRESETS:
        preset = THEME_TITLEBAR_PRESETS[bg]
        bg = preset["bg"]
        text = text or preset.get("text")
        border = border or preset.get("border")
        if is_dark is None:
            is_dark = preset.get("is_dark")

    # Tự động tính toán độ sáng tối nếu chưa được chỉ định
    if is_dark is None:
        is_dark = is_dark_color(bg) if bg else True

    # Xác định HWND cửa sổ
    hwnd = get_window_hwnd(window_or_hwnd, title=title)
    if not hwnd:
        logger.debug(f"[DWM] Could not find HWND for window: {window_or_hwnd}, title: {title}")
        return False

    try:
        dwmapi = ctypes.windll.dwmapi
        user32 = ctypes.windll.user32
        build = get_windows_build()

        # ── 1. WINDOWS 11 (Build >= 22000) ──────────────────────────────────
        if build >= 22000:
            # Tương phản nút điều khiển (Thu nhỏ / Phóng to / Đóng)
            dark_flag = ctypes.c_int(1 if is_dark else 0)
            dwmapi.DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                ctypes.byref(dark_flag),
                ctypes.sizeof(dark_flag)
            )

            # Màu nền thanh tiêu đề (Caption Color)
            if bg:
                caption_color = ctypes.c_int(hex_to_colorref(bg))
                dwmapi.DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_CAPTION_COLOR,
                    ctypes.byref(caption_color),
                    ctypes.sizeof(caption_color)
                )

            # Màu chữ tiêu đề (Text Color)
            if text:
                text_color = ctypes.c_int(hex_to_colorref(text))
                dwmapi.DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_TEXT_COLOR,
                    ctypes.byref(text_color),
                    ctypes.sizeof(text_color)
                )

            # Màu viền cửa sổ (Border Color)
            if border:
                border_color = ctypes.c_int(hex_to_colorref(border))
                dwmapi.DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_BORDER_COLOR,
                    ctypes.byref(border_color),
                    ctypes.sizeof(border_color)
                )

        # ── 2. WINDOWS 10 (Build < 22000) ───────────────────────────────────
        else:
            # Win 10 không hỗ trợ DWMWA_CAPTION_COLOR (35) hay DWMWA_TEXT_COLOR (36).
            # Bật/tắt DWMWA_USE_IMMERSIVE_DARK_MODE để Win 10 vẽ Dark Titlebar hoặc Light Titlebar.
            dark_flag = ctypes.c_int(1 if is_dark else 0)
            # Thử thuộc tính 20 (Windows 10 Build >= 19041)
            hr = dwmapi.DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                ctypes.byref(dark_flag),
                ctypes.sizeof(dark_flag)
            )
            # Nếu thất bại (trên bản Win 10 1809-1909 cũ hơn), thử thuộc tính 19
            if hr != 0 or build < 19041:
                dwmapi.DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1,
                    ctypes.byref(dark_flag),
                    ctypes.sizeof(dark_flag)
                )

        # ── 3. Ép DWM vẽ lại toàn bộ khung Non-Client ngay lập tức ──────────
        user32.SetWindowPos(
            hwnd,
            0,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED
        )
        return True

    except Exception as exc:
        logger.warning(f"[DWM] Failed to set titlebar theme for HWND {hwnd}: {exc}")
        return False
