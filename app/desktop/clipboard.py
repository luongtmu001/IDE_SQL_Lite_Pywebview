# -*- coding: utf-8 -*-
"""
Native Windows Clipboard integration using Win32 ctypes with Tkinter and PowerShell fallbacks.
Handles HWND foreground/active window targeting and Unicode text formats.
"""
import ctypes
import os
import subprocess
import time
from typing import Optional


def native_set_clipboard(text: str, hwnd=None) -> bool:
    """Set text onto the Windows clipboard using Win32 ctypes with multiple fallbacks."""
    content_str = str(text if text is not None else "")
    try:
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        user32.OpenClipboard.argtypes = [wintypes.HWND]
        user32.OpenClipboard.restype = wintypes.BOOL
        user32.EmptyClipboard.argtypes = []
        user32.EmptyClipboard.restype = wintypes.BOOL
        user32.CloseClipboard.argtypes = []
        user32.CloseClipboard.restype = wintypes.BOOL
        user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
        user32.SetClipboardData.restype = wintypes.HANDLE

        kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
        kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalLock.restype = wintypes.LPVOID
        kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalUnlock.restype = wintypes.BOOL

        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002

        candidate_hwnds = []
        if hwnd:
            candidate_hwnds.append(hwnd)
        try:
            fg = user32.GetForegroundWindow()
            if fg and fg not in candidate_hwnds:
                candidate_hwnds.append(fg)
            act = user32.GetActiveWindow()
            if act and act not in candidate_hwnds:
                candidate_hwnds.append(act)
        except Exception:
            pass
        candidate_hwnds.append(None)

        opened = False
        for _ in range(10):
            for h in candidate_hwnds:
                if user32.OpenClipboard(h):
                    opened = True
                    break
            if opened:
                break
            time.sleep(0.01)

        if opened:
            try:
                user32.EmptyClipboard()
                data = content_str.encode("utf-16le") + b"\x00\x00"
                h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
                if h_mem:
                    p_mem = kernel32.GlobalLock(h_mem)
                    if p_mem:
                        ctypes.memmove(p_mem, data, len(data))
                        kernel32.GlobalUnlock(h_mem)
                        res = user32.SetClipboardData(CF_UNICODETEXT, h_mem)
                        if res:
                            return True
            finally:
                user32.CloseClipboard()
    except Exception as e:
        print(f"[Clipboard] ctypes Win32 error: {e}")

    # Fallback 1: Tkinter standard library (reliable across interactive desktop sessions)
    try:
        import tkinter as tk

        r = tk.Tk()
        r.withdraw()
        r.clipboard_clear()
        r.clipboard_append(content_str)
        r.update()
        r.destroy()
        return True
    except Exception:
        pass

    # Fallback 2: PowerShell Set-Clipboard
    try:
        p = subprocess.Popen(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$input | Set-Clipboard",
            ],
            stdin=subprocess.PIPE,
            creationflags=0x08000000,
        )
        p.communicate(input=content_str.encode("utf-8"), timeout=3)
        if p.returncode == 0:
            return True
    except Exception:
        pass

    return False


def native_get_clipboard(hwnd=None) -> str:
    """Read text from the Windows clipboard using Win32 ctypes with multiple fallbacks."""
    try:
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        user32.OpenClipboard.argtypes = [wintypes.HWND]
        user32.OpenClipboard.restype = wintypes.BOOL
        user32.CloseClipboard.argtypes = []
        user32.CloseClipboard.restype = wintypes.BOOL
        user32.GetClipboardData.argtypes = [wintypes.UINT]
        user32.GetClipboardData.restype = wintypes.HANDLE

        kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalLock.restype = wintypes.LPVOID
        kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalUnlock.restype = wintypes.BOOL

        CF_UNICODETEXT = 13
        candidate_hwnds = []
        if hwnd:
            candidate_hwnds.append(hwnd)
        try:
            fg = user32.GetForegroundWindow()
            if fg and fg not in candidate_hwnds:
                candidate_hwnds.append(fg)
            act = user32.GetActiveWindow()
            if act and act not in candidate_hwnds:
                candidate_hwnds.append(act)
        except Exception:
            pass
        candidate_hwnds.append(None)

        opened = False
        for _ in range(10):
            for h in candidate_hwnds:
                if user32.OpenClipboard(h):
                    opened = True
                    break
            if opened:
                break
            time.sleep(0.01)

        if opened:
            try:
                h_mem = user32.GetClipboardData(CF_UNICODETEXT)
                if h_mem:
                    p_mem = kernel32.GlobalLock(h_mem)
                    if p_mem:
                        try:
                            return ctypes.c_wchar_p(p_mem).value or ""
                        finally:
                            kernel32.GlobalUnlock(h_mem)
            finally:
                user32.CloseClipboard()
    except Exception as e:
        print(f"[Clipboard] ctypes Win32 read error: {e}")

    # Fallback 1: Tkinter
    try:
        import tkinter as tk

        r = tk.Tk()
        r.withdraw()
        val = r.clipboard_get()
        r.destroy()
        return val or ""
    except Exception:
        pass

    # Fallback 2: PowerShell Get-Clipboard
    try:
        res = subprocess.check_output(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"],
            creationflags=0x08000000,
            timeout=3,
        )
        return res.decode("utf-8", errors="replace").rstrip("\r\n")
    except Exception:
        pass

    return ""


# Aliases for backward compatibility
_native_set_clipboard = native_set_clipboard
_native_get_clipboard = native_get_clipboard
