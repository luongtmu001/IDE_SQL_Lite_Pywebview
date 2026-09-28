# -*- coding: utf-8 -*-
"""
System Font Discovery Service for Desktop Native Application.
Enumerates installed fonts directly from the host operating system (Windows GDI / Registry / Unix fc-list).
Complies with .SKILL/global_ide_ui_typography_skill.md.
"""

import sys
import re

_CACHED_SYSTEM_FONTS = None


def get_system_fonts(force_refresh=False):
    """
    Retrieves all font families installed on the local computer.
    Returns:
        dict: {
            "all": list[str],        # All unique font family names sorted alphabetically
            "ui": list[str],         # Proportional fonts suitable for IDE UI
            "monospace": list[str]   # Monospace/fixed-pitch fonts for Editors & Grids
        }
    """
    global _CACHED_SYSTEM_FONTS
    if _CACHED_SYSTEM_FONTS is not None and not force_refresh:
        return _CACHED_SYSTEM_FONTS

    all_fonts = set()
    mono_fonts = set()

    if sys.platform == "win32":
        # 1. Primary: Windows GDI EnumFontFamiliesExW (clean font family names)
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            gdi32 = ctypes.windll.gdi32

            LF_FACESIZE = 32

            class LOGFONTW(ctypes.Structure):
                _fields_ = [
                    ("lfHeight", wintypes.LONG),
                    ("lfWidth", wintypes.LONG),
                    ("lfEscapement", wintypes.LONG),
                    ("lfOrientation", wintypes.LONG),
                    ("lfWeight", wintypes.LONG),
                    ("lfItalic", wintypes.BYTE),
                    ("lfUnderline", wintypes.BYTE),
                    ("lfStrikeOut", wintypes.BYTE),
                    ("lfCharSet", wintypes.BYTE),
                    ("lfOutPrecision", wintypes.BYTE),
                    ("lfClipPrecision", wintypes.BYTE),
                    ("lfQuality", wintypes.BYTE),
                    ("lfPitchAndFamily", wintypes.BYTE),
                    ("lfFaceName", wintypes.WCHAR * LF_FACESIZE),
                ]

            class ENUMLOGFONTEXW(ctypes.Structure):
                _fields_ = [
                    ("elfLogFont", LOGFONTW),
                    ("elfFullName", wintypes.WCHAR * 64),
                    ("elfStyle", wintypes.WCHAR * 32),
                    ("elfScript", wintypes.WCHAR * 32),
                ]

            FONTENUMPROCW = ctypes.WINFUNCTYPE(
                ctypes.c_int,
                ctypes.POINTER(ENUMLOGFONTEXW),
                ctypes.c_void_p,
                wintypes.DWORD,
                wintypes.LPARAM,
            )

            def enum_proc(lpelfe, lpntme, fontType, lParam):
                lf = lpelfe.contents.elfLogFont
                name = str(lf.lfFaceName).strip()
                if name and not name.startswith("@"):
                    all_fonts.add(name)
                    # Fixed pitch flag: bit 0 of lfPitchAndFamily
                    if (lf.lfPitchAndFamily & 3) == 1:
                        mono_fonts.add(name)
                return 1

            proc = FONTENUMPROCW(enum_proc)
            hdc = user32.GetDC(0)
            if hdc:
                try:
                    lf = LOGFONTW()
                    lf.lfCharSet = 1  # DEFAULT_CHARSET
                    gdi32.EnumFontFamiliesExW(hdc, ctypes.byref(lf), proc, 0, 0)
                finally:
                    user32.ReleaseDC(0, hdc)
        except Exception as e:
            print(f"[SystemFonts] GDI Enum error: {e}")

        # 2. Fallback / Augment: Windows Registry
        if not all_fonts or len(all_fonts) < 5:
            try:
                import winreg
                for root_key in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                    try:
                        with winreg.OpenKey(root_key, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts") as key:
                            for i in range(winreg.QueryInfoKey(key)[1]):
                                name, _, _ = winreg.EnumValue(key, i)
                                clean = re.sub(r"\s*\([^)]*\)$", "", name).strip()
                                if clean and not clean.startswith("@"):
                                    all_fonts.add(clean)
                    except Exception:
                        pass
            except Exception as e:
                print(f"[SystemFonts] Registry error: {e}")

    elif sys.platform == "darwin":
        mac_fonts = ["San Francisco", "Helvetica Neue", "Helvetica", "Menlo", "Monaco", "Courier", "Arial"]
        all_fonts.update(mac_fonts)
        mono_fonts.update(["Menlo", "Monaco", "Courier"])
    else:
        try:
            import subprocess
            out = subprocess.check_output(["fc-list", ":", "family"], text=True)
            for line in out.splitlines():
                for f in line.split(","):
                    f = f.strip()
                    if f and not f.startswith("@"):
                        all_fonts.add(f)
        except Exception:
            pass

    # Ensure curated / recommended cross-platform fonts exist
    curated_ui = [
        "Segoe UI", "Inter", "Arial", "Roboto", "Tahoma", "Calibri",
        "Verdana", "Trebuchet MS", "System UI", "Times New Roman"
    ]
    curated_code = [
        "Consolas", "JetBrains Mono", "Cascadia Code", "Fira Code",
        "Courier New", "Lucida Console"
    ]

    for f in curated_ui:
        all_fonts.add(f)
    for f in curated_code:
        all_fonts.add(f)
        mono_fonts.add(f)

    sorted_all = sorted(list(all_fonts), key=lambda s: s.lower())
    sorted_mono = sorted(list(mono_fonts), key=lambda s: s.lower())

    _CACHED_SYSTEM_FONTS = {
        "all": sorted_all,
        "ui": sorted_all,
        "monospace": sorted_mono
    }
    return _CACHED_SYSTEM_FONTS
