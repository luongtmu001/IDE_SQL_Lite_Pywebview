# -*- coding: utf-8 -*-
import base64
import gzip
import io
import json
import threading
import os
import re
import sys
import urllib.parse
import uuid
import xml.dom.minidom
import xml.etree.ElementTree as ET
import zipfile
import zlib
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
from app.utils.crypto import encrypt_password, decrypt_password
from app.utils.dwm import apply_dwm_titlebar_theme, THEME_TITLEBAR_PRESETS
from app.services.connection_manager import ConnectionManager
from app.services.table_designer_service import TableDesignerService
from app.services.table_data_editor_service import TableDataEditorService
from app.database.factory import create_adapter

DATA_DIR = APP_DIR / "data"
SETTINGS_FILE = DATA_DIR / "settings.json"
SETTINGS_FILE_ALT = APP_DIR / "settings" / "settings.json"
CONNECTIONS_FILE = DATA_DIR / "connections.json" 
SNIPPETS_FILE = DATA_DIR / "snippets.json"
PROGRAM_LIST_FILE = DATA_DIR / "programlist.json"
PROGRAM_GROUPS_FILE = DATA_DIR / "programgroups.json"
REDGATE_SNIPPETS_DIR = Path(r"C:\Users\luonght\AppData\Local\Red Gate\SQL Prompt 10\Snippets")

connection_manager = ConnectionManager()
_OWNER_SESSION = "desktop_user"


def _read_json(file_path, default):
    try:
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8-sig") as f:
                return json.load(f)
    except Exception as e:
        print(f"[Storage] Read error {file_path}: {e}")
    return default


def _write_json(file_path, data):
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[Storage] Write error {file_path}: {e}")
        return False


def _load_settings_file():
    settings = None
    if SETTINGS_FILE.exists():
        settings = _read_json(SETTINGS_FILE, None)
    if not settings and SETTINGS_FILE_ALT.exists():
        settings = _read_json(SETTINGS_FILE_ALT, None)
    if not settings and (BUNDLE_DIR / "settings" / "settings.json").exists():
        settings = _read_json(BUNDLE_DIR / "settings" / "settings.json", None)
    if not settings:
        settings = {
            "theme": "dark",
            "editor": {
                "fontFamily": "Consolas",
                "fontSize": 14,
                "tabSize": 4,
                "insertSpaces": True,
                "wordWrap": False,
                "minimap": True,
                "keywordCase": "upper",
            },
            "appearance": {"theme": "dark", "iconSize": 16},
            "grid": {"fontFamily": "Segoe UI", "fontSize": 13},
            "messages": {"fontFamily": "Consolas", "fontSize": 13},
            "sql": {"maxRows": 1000, "timeoutSeconds": 30},
            "addons": {"bravo_tool": {"enabled": True}},
        }
    cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
    settings["theme"] = cur_theme
    if "appearance" not in settings or not isinstance(settings["appearance"], dict):
        settings["appearance"] = {"theme": cur_theme, "iconSize": 16}
    else:
        settings["appearance"]["theme"] = cur_theme
    if "addons" not in settings or not isinstance(settings["addons"], dict):
        settings["addons"] = {"bravo_tool": {"enabled": True}}
    elif "bravo_tool" not in settings["addons"] or not isinstance(settings["addons"]["bravo_tool"], dict):
        settings["addons"]["bravo_tool"] = {"enabled": True}
    elif "enabled" not in settings["addons"]["bravo_tool"]:
        settings["addons"]["bravo_tool"]["enabled"] = True
    return settings


def _save_settings_file(settings):
    if isinstance(settings, dict):
        cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
        settings["theme"] = cur_theme
        if "appearance" not in settings or not isinstance(settings["appearance"], dict):
            settings["appearance"] = {"theme": cur_theme, "iconSize": 16}
        else:
            settings["appearance"]["theme"] = cur_theme
    ok1 = _write_json(SETTINGS_FILE, settings)
    if SETTINGS_FILE_ALT.parent.exists():
        _write_json(SETTINGS_FILE_ALT, settings)
    return ok1


def _clean_jsonc(text: str) -> str:
    pattern = r'("(?:\\.|[^"\\])*")|(/\*[\s\S]*?\*/)|(//[^\r\n]*)'
    def replace(match):
        if match.group(1):
            return match.group(1)
        return ''
    cleaned = re.sub(pattern, replace, text)
    cleaned = re.sub(r',\s*([\}\]])', r'\1', cleaned)
    return cleaned


def _hex_to_rgb(color: str):
    if not color or not isinstance(color, str):
        return None
    c = color.strip().lstrip('#')
    if len(c) == 3:
        c = ''.join([ch * 2 for ch in c])
    if len(c) >= 6:
        try:
            return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
        except Exception:
            return None
    return None


def _is_dark_color(color: str, fallback=True) -> bool:
    rgb = _hex_to_rgb(color)
    if not rgb:
        return fallback
    lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    return lum < 128


def _generate_theme_css(theme_id: str, theme_name: str, theme_data: dict, is_dark: bool) -> dict:
    colors = theme_data.get('colors', {})

    bg_editor = colors.get('editor.background') or ('#18191E' if is_dark else '#ffffff')
    bg_sidebar = colors.get('sideBar.background') or bg_editor
    bg_main = bg_sidebar
    bg_toolbar = colors.get('titleBar.activeBackground') or colors.get('activityBar.background') or bg_sidebar
    bg_panel = colors.get('panel.background') or bg_editor
    bg_input = colors.get('input.background') or (colors.get('editorWidget.background') or bg_editor)
    bg_modal = colors.get('editorWidget.background') or bg_sidebar
    bg_dropdown = colors.get('dropdown.background') or bg_modal
    bg_context_menu = colors.get('menu.background') or bg_modal

    fg_text = colors.get('editor.foreground') or colors.get('foreground') or ('#c7cfcf' if is_dark else '#2b2b2b')
    fg_muted = colors.get('descriptionForeground') or colors.get('editorLineNumber.foreground') or ('#848c94' if is_dark else '#6c757d')
    fg_active = colors.get('editor.foreground') or ('#ffffff' if is_dark else '#000000')

    border = colors.get('sideBar.border') or colors.get('panel.border') or colors.get('tab.border') or ('#3c3f41' if is_dark else '#cccccc')
    accent = colors.get('button.background') or colors.get('activityBarBadge.background') or colors.get('focusBorder') or ('#CC7832' if is_dark else '#0066cc')
    border_active = colors.get('focusBorder') or accent

    titlebar_bg = colors.get('titleBar.activeBackground') or bg_toolbar
    titlebar_text = colors.get('titleBar.activeForeground') or ('#ffffff' if _is_dark_color(titlebar_bg) else '#000000')

    tab_active_bg = colors.get('tab.activeBackground') or bg_editor
    tab_inactive_bg = colors.get('tab.inactiveBackground') or bg_toolbar
    tab_active_border = colors.get('tab.activeBorder') or accent
    grid_header_bg = colors.get('sideBarSectionHeader.background') or tab_inactive_bg

    danger = colors.get('errorForeground') or colors.get('editorError.foreground') or '#ff5c5c'
    warning = colors.get('editorWarning.foreground') or '#E8C859'
    info = colors.get('editorInfo.foreground') or '#6897BB'
    success = '#6A8759' if is_dark else '#4a7c3f'

    rgb_accent = _hex_to_rgb(accent) or (204, 120, 50)
    rgb_accent_str = f"{rgb_accent[0]},{rgb_accent[1]},{rgb_accent[2]}"

    css_block = f"""
/* ── VSIX Imported Theme: {theme_name} ({theme_id}) ────────────────────────── */
html[data-bs-theme="{theme_id}"] {{
    --ide-theme-id:                 "{theme_id}";
    --ide-theme-name:               "{theme_name}";
    --ide-titlebar-bg:              {titlebar_bg};
    --ide-titlebar-text:            {titlebar_text};

    /* Bootstrap overrides */
    --bs-body-bg:                   {bg_main};
    --bs-body-color:                {fg_text};
    --bs-border-color:              {border};
    --bs-border-color-translucent:  rgba(120, 120, 120, 0.35);
    --bs-primary:                   {accent};
    --bs-primary-rgb:               {rgb_accent_str};
    --bs-dark:                      {bg_toolbar};
    --bs-secondary:                 {fg_muted};
    --bs-link-color:                {accent};
    --bs-link-hover-color:          {accent};

    /* IDE surface layers */
    --ide-bg-main:                  {bg_main};
    --ide-bg-sidebar:               {bg_sidebar};
    --ide-bg-toolbar:               {bg_toolbar};
    --ide-bg-editor:                {bg_editor};
    --ide-bg-panel:                 {bg_panel};
    --ide-bg-result:                {bg_editor};
    --ide-bg-input:                 {bg_input};
    --ide-bg-modal:                 {bg_modal};
    --ide-bg-dropdown:              {bg_dropdown};
    --ide-bg-context-menu:          {bg_context_menu};

    /* Borders */
    --ide-border:                   {border};
    --ide-border-active:            {border_active};

    /* Typography */
    --ide-text-main:                {fg_text};
    --ide-text-muted:               {fg_muted};
    --ide-text-active:              {fg_active};
    --ide-text-dim:                 {fg_muted};

    /* Interactive states */
    --ide-hover-bg:                 rgba(128, 128, 128, 0.12);
    --ide-active-bg:                rgba({rgb_accent_str}, 0.20);
    --ide-selection-bg:             rgba({rgb_accent_str}, 0.25);

    /* Accent */
    --ide-accent:                   {accent};
    --ide-syntax-keyword:           {accent};
    --ide-accent-hover:             {accent};
    --ide-accent-subtle:            rgba({rgb_accent_str}, 0.15);

    /* Status indicators */
    --ide-danger:                   {danger};
    --ide-success:                  {success};
    --ide-warning:                  {warning};
    --ide-info:                     {info};

    /* Tabs */
    --ide-tab-active-bg:            {tab_active_bg};
    --ide-tab-inactive-bg:          {tab_inactive_bg};
    --ide-tab-active-border:        {tab_active_border};

    /* Result Grid */
    --ide-grid-header-bg:           {grid_header_bg};
    --ide-grid-row-alt:             rgba(128, 128, 128, 0.04);
    --ide-grid-row-hover:           rgba(128, 128, 128, 0.08);

    /* Action bar & Badges */
    --ide-action-bar-bg:            {bg_toolbar};
    --ide-badge-bg:                 {tab_inactive_bg};
    --ide-badge-text:               {fg_text};
    --ide-badge-hover:              {border};

    /* Context menu */
    --ide-ctx-item-hover:           rgba({rgb_accent_str}, 0.18);
    --ide-ctx-separator:            {border};

    /* Scrollbars */
    --ide-scroll-track:             {bg_toolbar};
    --ide-scroll-thumb:             {border};
    --ide-scroll-thumb-hover:       {fg_muted};
}}
"""
    cm_theme = 'darcula' if is_dark else 'default'
    return {
        "theme_id": theme_id,
        "theme_name": theme_name,
        "is_dark": is_dark,
        "cm_theme": cm_theme,
        "titlebar_bg": titlebar_bg,
        "titlebar_text": titlebar_text,
        "border": border,
        "css": css_block
    }


def _process_import_vsix_theme(vsix_path: str) -> dict:
    if not os.path.isfile(vsix_path):
        return {"success": False, "error": f"Không tìm thấy file: {vsix_path}"}

    try:
        with zipfile.ZipFile(vsix_path, 'r') as z:
            pkg_entry = None
            for name in z.namelist():
                if name in ('extension/package.json', 'package.json'):
                    pkg_entry = name
                    break
            if not pkg_entry:
                return {"success": False, "error": "Không tìm thấy file package.json trong tệp .vsix!"}

            pkg_raw = z.read(pkg_entry).decode('utf-8', errors='replace')
            pkg = json.loads(_clean_jsonc(pkg_raw))

            themes = pkg.get('contributes', {}).get('themes', [])
            if not themes:
                return {"success": False, "error": "Không tìm thấy thông tin theme nào trong contributes.themes của package.json!"}

            # Nạp tất cả các theme có trong gói .vsix
            theme_entries = []
            has_dark = False
            has_light = False

            for idx, t_info in enumerate(themes):
                t_path = t_info.get('path', '').lstrip('./')
                if t_path.startswith('/'):
                    t_path = t_path.lstrip('/')

                theme_file_entry = None
                for candidate in [t_path, f"extension/{t_path}"]:
                    if candidate in z.namelist():
                        theme_file_entry = candidate
                        break
                if not theme_file_entry:
                    base_t = os.path.basename(t_path)
                    for name in z.namelist():
                        if os.path.basename(name) == base_t:
                            theme_file_entry = name
                            break
                if not theme_file_entry:
                    continue

                try:
                    theme_raw = z.read(theme_file_entry).decode('utf-8', errors='replace')
                    theme_data = json.loads(_clean_jsonc(theme_raw))
                except Exception as parse_err:
                    print(f"[VSIX] Failed to parse theme JSON {theme_file_entry}: {parse_err}")
                    continue

                colors = theme_data.get('colors', {})
                ui_theme = str(t_info.get('uiTheme') or theme_data.get('type') or 'dark').lower()
                bg_editor = colors.get('editor.background') or ('#18191E' if ('dark' in ui_theme or 'hc' in ui_theme) else '#ffffff')
                is_dark = _is_dark_color(bg_editor, fallback=('dark' in ui_theme or 'hc' in ui_theme))

                if is_dark:
                    has_dark = True
                else:
                    has_light = True

                theme_entries.append({
                    "info": t_info,
                    "data": theme_data,
                    "is_dark": is_dark,
                    "idx": idx
                })

            if not theme_entries:
                return {"success": False, "error": "Không thể nạp bất kỳ file theme nào từ gói .vsix!"}

            # Xác định tên theme hiển thị và mã định danh duy nhất (theme_id)
            candidates = []
            seen_in_batch = set()

            for item in theme_entries:
                t_info = item["info"]
                t_data = item["data"]
                is_dark = item["is_dark"]
                idx = item["idx"]

                base_label = (
                    t_info.get('label') or
                    t_data.get('name') or
                    pkg.get('displayName') or
                    pkg.get('name') or
                    f"Theme {idx+1}"
                ).strip()

                # Nếu gói vsix có cả theme Dark và Light: chuẩn hóa tên phân biệt kiểu rõ ràng
                if has_dark and has_light:
                    base = re.sub(r'[\s\-_]+(light|dark)$', '', base_label, flags=re.I).strip()
                    if not base:
                        base = base_label
                    theme_name = f"{base} (Dark)" if is_dark else f"{base} (Light)"
                else:
                    theme_name = base_label

                raw_id = t_info.get('id') or theme_name
                theme_id = re.sub(r'[^a-zA-Z0-9_-]+', '-', raw_id.lower()).strip('-')
                if not theme_id:
                    theme_id = f"theme-{idx+1}"

                if theme_id in seen_in_batch:
                    theme_id = f"{theme_id}-{'dark' if is_dark else 'light'}"
                seen_in_batch.add(theme_id)

                theme_css_info = _generate_theme_css(theme_id, theme_name, t_data, is_dark)
                candidates.append(theme_css_info)

            # Kiểm tra trùng lặp trong hệ thống
            style_css_file = BASE_DIR / "static" / "css" / "style.css"
            theme_vars_file = BASE_DIR / "static" / "css" / "theme-variables.css"
            theme_reg_file = BASE_DIR / "static" / "js" / "theme-registry.js"

            existing_ids = {'dark', 'light', 'win-nt', 'win-xp', 'monokai', 'nord'}
            existing_names = set()

            if theme_vars_file.exists():
                with open(theme_vars_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                existing_ids.update(re.findall(r'data-bs-theme=[\'"]([^\'"]+)[\'"]', content))

            if style_css_file.exists():
                with open(style_css_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                existing_ids.update(re.findall(r'data-bs-theme=[\'"]([^\'"]+)[\'"]', content))

            if theme_reg_file.exists():
                with open(theme_reg_file, 'r', encoding='utf-8') as f:
                    reg_content = f.read()
                existing_ids.update(re.findall(r'id:\s*[\'"]([^\'"]+)[\'"]', reg_content))
                existing_names.update([n.lower().strip() for n in re.findall(r'name:\s*[\'"]([^\'"]+)[\'"]', reg_content)])

            themes_to_add = []
            duplicate_names = []

            for c in candidates:
                is_dup = (
                    c["theme_id"] in existing_ids or
                    (c["theme_id"] == 'windows-nt' and 'win-nt' in existing_ids) or
                    (c["theme_id"] == 'win-nt' and 'windows-nt' in existing_ids) or
                    c["theme_name"].lower().strip() in existing_names
                )
                if is_dup:
                    duplicate_names.append(f"'{c['theme_name']}' ({c['theme_id']})")
                else:
                    themes_to_add.append(c)

            if not themes_to_add:
                return {
                    "success": False,
                    "duplicate": True,
                    "theme_id": candidates[0]["theme_id"],
                    "theme_name": candidates[0]["theme_name"],
                    "message": f"Theme {', '.join(duplicate_names)} đã tồn tại trong hệ thống. Không thể import trùng lặp!"
                }

            combined_css = "\n".join([t["css"] for t in themes_to_add])

            # 1. Ghi vào style.css theo đúng yêu cầu
            target_files = [style_css_file]
            if (APP_DIR / "static" / "css" / "style.css").resolve() != style_css_file.resolve():
                target_files.append(APP_DIR / "static" / "css" / "style.css")

            for s_file in target_files:
                if s_file.exists():
                    with open(s_file, "a", encoding="utf-8") as f:
                        f.write(combined_css)

            # 2. Ghi vào theme-variables.css
            vars_files = [theme_vars_file]
            if (APP_DIR / "static" / "css" / "theme-variables.css").resolve() != theme_vars_file.resolve():
                vars_files.append(APP_DIR / "static" / "css" / "theme-variables.css")

            for v_file in vars_files:
                if v_file.exists():
                    with open(v_file, "a", encoding="utf-8") as f:
                        f.write(combined_css)

            # 3. Cập nhật theme-registry.js đảm bảo cấu trúc mảng JS hợp lệ với dấu phẩy phân tách
            reg_files = [theme_reg_file]
            if (APP_DIR / "static" / "js" / "theme-registry.js").resolve() != theme_reg_file.resolve():
                reg_files.append(APP_DIR / "static" / "js" / "theme-registry.js")

            for r_file in reg_files:
                if r_file.exists():
                    with open(r_file, "r", encoding="utf-8") as f:
                        reg_code = f.read()

                    idx = reg_code.rfind("    ];")
                    if idx == -1:
                        idx = reg_code.rfind("];")

                    if idx != -1:
                        before = reg_code[:idx].rstrip()
                        if not before.endswith(','):
                            before += ','

                        entries_str = ""
                        for item in themes_to_add:
                            entries_str += (
                                f"\n        {{\n"
                                f"            id: '{item['theme_id']}',\n"
                                f"            name: '{item['theme_name']}',\n"
                                f"            isDark: {'true' if item['is_dark'] else 'false'},\n"
                                f"            cmTheme: '{item['cm_theme']}',\n"
                                f"            titlebarBg: '{item['titlebar_bg']}',\n"
                                f"            titlebarText: '{item['titlebar_text']}',\n"
                                f"            border: '{item['border']}'\n"
                                f"        }},"
                            )

                        match_len = 6 if reg_code[idx:idx+6] == "    ];" else 2
                        new_reg_code = before + entries_str + "\n    ];" + reg_code[idx + match_len:]
                        with open(r_file, "w", encoding="utf-8") as f:
                            f.write(new_reg_code)

            primary_theme = themes_to_add[0]
            theme_names_str = ", ".join([f"'{t['theme_name']}'" for t in themes_to_add])
            return {
                "success": True,
                "theme_id": primary_theme["theme_id"],
                "theme_name": primary_theme["theme_name"],
                "is_dark": primary_theme["is_dark"],
                "cm_theme": primary_theme["cm_theme"],
                "titlebar_bg": primary_theme["titlebar_bg"],
                "titlebar_text": primary_theme["titlebar_text"],
                "border": primary_theme["border"],
                "css": combined_css,
                "imported_themes": themes_to_add,
                "message": f"Đã import thành công {len(themes_to_add)} theme ({theme_names_str})!"
            }

    except Exception as exc:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": f"Lỗi khi giải nén file .vsix: {str(exc)}"}


def _load_snippets_file():
    if SNIPPETS_FILE.exists():
        data = _read_json(SNIPPETS_FILE, None)
        if isinstance(data, list):
            return data
    alt_file = BUNDLE_DIR / "static" / "data" / "snippets.json"
    if alt_file.exists():
        data = _read_json(alt_file, None)
        if isinstance(data, list):
            return data
    return _import_redgate_snippets()


def _save_snippets_file(snippets):
    if not isinstance(snippets, list):
        return False
    ok = _write_json(SNIPPETS_FILE, snippets)
    alt_file = BUNDLE_DIR / "static" / "data" / "snippets.json"
    _write_json(alt_file, snippets)
    return ok


def _import_redgate_snippets():
    snippets = []
    if REDGATE_SNIPPETS_DIR.exists():
        for fp in REDGATE_SNIPPETS_DIR.glob("*.json"):
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    snippets.append(json.load(f))
            except Exception as e:
                print(f"[Snippets] Read error {fp}: {e}")
    snippets.sort(key=lambda s: s.get("prefix", "").lower())
    _save_snippets_file(snippets)
    return snippets


# -------------------------------------------------------------------------
# Native Windows Clipboard Helpers (Win32 ctypes)
# -------------------------------------------------------------------------

def _native_set_clipboard(text: str) -> bool:
    try:
        import ctypes
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

        import time
        opened = False
        for _ in range(10):
            if user32.OpenClipboard(None):
                opened = True
                break
            time.sleep(0.01)
        if not opened:
            return False

        try:
            user32.EmptyClipboard()
            data = str(text if text is not None else "").encode('utf-16le') + b'\x00\x00'
            h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
            if h_mem:
                p_mem = kernel32.GlobalLock(h_mem)
                if p_mem:
                    ctypes.memmove(p_mem, data, len(data))
                    kernel32.GlobalUnlock(h_mem)
                    res = user32.SetClipboardData(CF_UNICODETEXT, h_mem)
                    return bool(res)
        finally:
            user32.CloseClipboard()
        return False
    except Exception as e:
        print(f"[Clipboard] Error setting clipboard: {e}")
        return False


def _native_get_clipboard() -> str:
    try:
        import ctypes
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
        import time
        opened = False
        for _ in range(10):
            if user32.OpenClipboard(None):
                opened = True
                break
            time.sleep(0.01)
        if not opened:
            return ""

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
        return ""
    except Exception as e:
        print(f"[Clipboard] Error getting clipboard: {e}")
        return ""


# -------------------------------------------------------------------------
# Bravo XML Helpers
# -------------------------------------------------------------------------

def _beautify_xml_string(xml_str):
    if not xml_str or not xml_str.strip():
        return ""
    s = xml_str.strip()
    try:
        dom = xml.dom.minidom.parseString(s)
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.splitlines() if line.strip()]
        return "\n".join(lines)
    except Exception:
        pass

    try:
        wrapped = f"<root>{s}</root>"
        dom = xml.dom.minidom.parseString(wrapped)
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.splitlines() if line.strip()]
        lines = [l for l in lines if not l.startswith("<?xml")]
        if len(lines) >= 2 and lines[0].strip() == "<root>" and lines[-1].strip() == "</root>":
            inner_lines = lines[1:-1]
            outdented = [l[2:] if l.startswith("  ") else l for l in inner_lines]
            return "\n".join(outdented)
    except Exception:
        pass

    try:
        clean = s.replace("><", ">\n<")
        formatted = []
        pad = 0
        for line in clean.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.startswith("</"):
                if pad > 0:
                    pad -= 1
            indent_str = "  " * pad
            formatted.append(indent_str + line)
            if line.startswith("<") and not line.startswith("</") and not line.startswith("<?") and not line.endswith("/>") and "</" not in line:
                pad += 1
        return "\n".join(formatted)
    except Exception:
        return xml_str


def _decode_xml_payload(raw_val, version):
    if not raw_val:
        return ""
    raw_bytes = None
    if isinstance(raw_val, bytes):
        raw_bytes = raw_val
    elif isinstance(raw_val, str):
        str_val = raw_val.strip()
        if str_val.lower().startswith("0x"):
            try:
                raw_bytes = bytes.fromhex(str_val[2:])
            except Exception:
                pass
        elif str_val.lower().startswith("504b0304"):
            try:
                raw_bytes = bytes.fromhex(str_val)
            except Exception:
                pass
        if raw_bytes is None and (str_val.startswith("<") or str_val.startswith("<?xml")):
            return _beautify_xml_string(str_val)
        if raw_bytes is None:
            try:
                raw_bytes = base64.b64decode(str_val)
            except Exception:
                raw_bytes = str_val.encode("utf-8", errors="replace")

    if not raw_bytes:
        return ""

    result_text = ""
    if len(raw_bytes) >= 4 and raw_bytes[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                names = z.namelist()
                if names:
                    result_text = z.read(names[0]).decode("utf-8", errors="replace")
        except Exception:
            pass

    if not result_text and len(raw_bytes) >= 2 and raw_bytes[:2] == b"\x1f\x8b":
        try:
            result_text = gzip.decompress(raw_bytes).decode("utf-8", errors="replace")
        except Exception:
            pass

    if not result_text and len(raw_bytes) >= 2 and raw_bytes[0] == 0x78:
        try:
            result_text = zlib.decompress(raw_bytes).decode("utf-8", errors="replace")
        except Exception:
            pass

    if not result_text:
        try:
            result_text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            result_text = raw_bytes.decode("utf-16", errors="replace")

        trimmed = result_text.strip()
        if not (trimmed.startswith("<") or trimmed.startswith("<?xml")):
            try:
                b64_bytes = base64.b64decode(trimmed)
                if len(b64_bytes) >= 4 and b64_bytes[:4] == b"PK\x03\x04":
                    with zipfile.ZipFile(io.BytesIO(b64_bytes)) as z:
                        names = z.namelist()
                        if names:
                            result_text = z.read(names[0]).decode("utf-8", errors="replace")
                else:
                    b64_str = b64_bytes.decode("utf-8", errors="replace")
                    if b64_str.strip().startswith("<"):
                        result_text = b64_str
            except Exception:
                pass

    return _beautify_xml_string(result_text)


def _encode_xml_payload(xml_str, version=None, format_type="zip"):
    """
    Encode XML payload to store back into Database.
    Bravo Win & Mobile store LayoutData as a ZIP archive (Deflate)
    containing an internal entry named 'Xml' (b'PK\x03\x04...').
    """
    if not xml_str:
        return b""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("Xml", xml_str.encode("utf-8"))
    return buffer.getvalue()


def _validate_xml_syntax(xml_str):
    if not xml_str or not xml_str.strip():
        return True, None
    try:
        ET.fromstring(xml_str.strip())
        return True, None
    except ET.ParseError as err:
        return False, str(err)


# -------------------------------------------------------------------------
# BravoApi
# -------------------------------------------------------------------------


class BravoApi:
    def __init__(self, cm: ConnectionManager, owner_session_id: str = None, initial_context: dict = None, main_api=None):
        self.cm = cm
        self.owner_session_id = owner_session_id or f"bravo_user_{uuid.uuid4().hex[:8]}"
        self.initial_context = initial_context or {}
        self._bravo_sessions = {}
        self._window = None
        self._profiler_windows = []
        self._main_api = main_api
        self._current_titlebar_theme = None

    def set_window(self, win):
        self._window = win

    def ready(self):
        if self._window:
            try:
                self._window.show()
            except Exception:
                pass
            import threading
            for delay in (0.05, 0.2, 0.5):
                threading.Timer(delay, lambda: self.apply_titlebar_theme()).start()
        return {"success": True}

    def apply_titlebar_theme(self, bg_hex=None, text_hex=None, border_hex=None, is_dark=None):
        """Đồng bộ màu sắc thanh tiêu đề Windows qua DWM API cho tất cả các cửa sổ đang mở."""
        if getattr(self, '_main_api', None) and self._main_api is not self:
            try:
                return self._main_api.apply_titlebar_theme(bg_hex, text_hex, border_hex, is_dark)
            except Exception:
                pass

        try:
            if not bg_hex and getattr(self, '_current_titlebar_theme', None):
                t = self._current_titlebar_theme
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

            self._current_titlebar_theme = {
                "bg": bg_hex,
                "text": text_hex,
                "border": border_hex,
                "is_dark": is_dark
            }

            # 1. Áp dụng cho Main Window
            if getattr(self, "_window", None):
                apply_dwm_titlebar_theme(
                    self._window,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="luoBTool IDE"
                )

            # 2. Áp dụng cho Settings Window
            if getattr(self, "_settings_window", None):
                apply_dwm_titlebar_theme(
                    self._settings_window,
                    bg=bg_hex,
                    text=text_hex,
                    border=border_hex,
                    is_dark=is_dark,
                    title="Cài đặt (Settings) — luoBTool IDE"
                )

            # 3. Áp dụng cho các cửa sổ BRAVO Tool
            for bw in getattr(self, "_bravo_windows", []):
                if bw:
                    apply_dwm_titlebar_theme(
                        bw,
                        bg=bg_hex,
                        text=text_hex,
                        border=border_hex,
                        is_dark=is_dark
                    )

            # 4. Áp dụng cho các cửa sổ Profiler
            for pw in getattr(self, "_profiler_windows", []):
                if pw:
                    apply_dwm_titlebar_theme(
                        pw,
                        bg=bg_hex,
                        text=text_hex,
                        border=border_hex,
                        is_dark=is_dark,
                        title="SQL Trace Profiler — luoBTool IDE"
                    )

            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # Native Clipboard Bridge
    def set_clipboard_text(self, text):
        try:
            ok = _native_set_clipboard(text)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_clipboard_text(self):
        try:
            val = _native_get_clipboard()
            return {"success": True, "text": val}
        except Exception as exc:
            return {"success": False, "error": str(exc), "text": ""}

    # Table Data Editor Methods
    def get_table_editor_metadata(self, connection_id, database=None, schema=None, table=None):
        try:
            if not table:
                return {"success": False, "error": "Tên bảng là bắt buộc (table is required)"}
            conn = self._get_connection(connection_id)
            meta = TableDataEditorService.get_metadata(conn.adapter, database, schema, table)
            return {"success": True, "metadata": meta}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def fetch_table_data(self, connection_id, database=None, schema=None, table=None, select_cols=None, criteria=None, top_n=200, custom_sql=None):
        try:
            if not table and not custom_sql:
                return {"success": False, "error": "Tên bảng hoặc câu truy vấn là bắt buộc"}
            conn = self._get_connection(connection_id)
            data = TableDataEditorService.fetch_data(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                select_cols=select_cols,
                criteria=criteria,
                top_n=top_n,
                custom_sql=custom_sql
            )
            return {"success": True, **data}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def update_table_row(self, connection_id, database=None, schema=None, table=None, pk_conditions=None, changes=None):
        try:
            conn = self._get_connection(connection_id)
            result = TableDataEditorService.update_row(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                pk_conditions=pk_conditions or {},
                changes=changes or {}
            )
            return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def delete_table_row(self, connection_id, database=None, schema=None, table=None, pk_conditions=None):
        try:
            conn = self._get_connection(connection_id)
            result = TableDataEditorService.delete_row(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                pk_conditions=pk_conditions or {}
            )
            return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def insert_table_row(self, connection_id, database=None, schema=None, table=None, values=None, identity_columns=None, computed_columns=None):
        try:
            conn = self._get_connection(connection_id)
            result = TableDataEditorService.insert_row(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                values=values or {},
                identity_columns=identity_columns,
                computed_columns=computed_columns
            )
            return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def submit_table_changes(self, connection_id, database=None, schema=None, table=None, changes=None, concurrency_mode="optimistic"):
        try:
            conn = self._get_connection(connection_id)
            result = TableDataEditorService.submit_changes(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                changes=changes or {},
                concurrency_mode=concurrency_mode
            )
            return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def validate_table_rows(self, connection_id, database=None, schema=None, table=None, rows=None):
        try:
            conn = self._get_connection(connection_id)
            result = TableDataEditorService.validate_insert_rows(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                rows=rows or []
            )
            return result
        except Exception as exc:
            return {"success": False, "error": str(exc), "total": len(rows or []), "valid_count": 0, "error_count": len(rows or []), "results": []}

    def validate_table_row(self, connection_id, database=None, schema=None, table=None, values=None, keys=None, is_new=True, target_column=None):
        try:
            conn = self._get_connection(connection_id)
            result = TableDataEditorService.validate_row(
                adapter=conn.adapter,
                database=database,
                schema=schema,
                table=table,
                values=values or {},
                keys=keys,
                is_new=is_new,
                target_column=target_column
            )
            return result
        except Exception as exc:
            return {"valid": False, "error": str(exc)}

    def get_initial_context(self):
        return {"success": True, "context": self.initial_context}

    def set_window_title(self, title):
        if self._window:
            try:
                self._window.set_title(title)
                return {"success": True}
            except Exception:
                pass
        return {"success": False}

    def get_config(self):
        settings = _load_settings_file()
        enabled = settings.get("addons", {}).get("bravo_tool", {}).get("enabled", True)
        return {"success": True, "enabled": bool(enabled)}

    def list_features(self):
        features = [
            {
                "id": "program-list",
                "displayName": "Danh sách chương trình",
                "icon": "fa-list-check",
                "order": 5,
                "description": "Quản lý danh sách kết nối và khởi chạy nhanh các chương trình BRAVO"
            },
            {
                "id": "layout-editor",
                "displayName": "Soạn thảo layout",
                "icon": "fa-table-columns",
                "order": 10,
                "description": "Thiết kế và soạn thảo layout báo cáo / form hiển thị"
            }
        ]
        return {"success": True, "features": features}

    def get_program_list(self):
        try:
            programs = _read_json(PROGRAM_LIST_FILE, [])
            if not isinstance(programs, list):
                programs = []
            res = []
            for p in programs:
                if not isinstance(p, dict):
                    continue
                item = dict(p)
                if item.get("password"):
                    item["password"] = decrypt_password(item["password"])
                res.append(item)
            return {"success": True, "programs": res}
        except Exception as exc:
            return {"success": False, "error": str(exc), "programs": []}

    def save_program_list(self, programs):
        try:
            if not isinstance(programs, list):
                return {"success": False, "error": "Dữ liệu chương trình không hợp lệ"}
            to_save = []
            for p in programs:
                if not isinstance(p, dict):
                    continue
                item = dict(p)
                pwd = item.get("password")
                if pwd and not str(pwd).startswith("ENC:"):
                    item["password"] = encrypt_password(pwd)
                to_save.append(item)
            ok = _write_json(PROGRAM_LIST_FILE, to_save)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_program_groups(self):
        try:
            groups = _read_json(PROGRAM_GROUPS_FILE, [])
            if not isinstance(groups, list):
                groups = []
            return {"success": True, "groups": groups}
        except Exception as exc:
            return {"success": False, "error": str(exc), "groups": []}

    def save_program_groups(self, groups):
        try:
            if not isinstance(groups, list):
                return {"success": False, "error": "Dữ liệu nhóm không hợp lệ"}
            to_save = []
            for g in groups:
                if not isinstance(g, dict):
                    continue
                to_save.append({
                    "id": str(g.get("id") or ""),
                    "name": str(g.get("name") or "").strip()
                })
            ok = _write_json(PROGRAM_GROUPS_FILE, to_save)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def select_program_file(self):
        try:
            target_win = getattr(self, '_window', None)
            if not target_win and hasattr(self, '_main_api') and self._main_api:
                target_win = getattr(self._main_api, '_window', None)

            # 1. Ưu tiên tuyệt đối sử dụng hộp thoại chuẩn của pywebview trên cửa sổ hiện hành
            if target_win:
                import webview
                files = target_win.create_file_dialog(
                    webview.OPEN_DIALOG,
                    allow_multiple=False,
                    file_types=('Executable Files (*.exe;*.bat;*.cmd)', 'All files (*.*)')
                )
                if files and len(files) > 0:
                    return {"success": True, "path": files[0]}
                # Người dùng bấm Hủy (Cancel) hoặc đóng hộp thoại -> dừng lại, không mở thêm cửa sổ thứ 2
                return {"success": False, "cancelled": True}

            # 2. Fallback Tkinter chỉ dùng khi hoàn toàn không có cửa sổ webview nào (môi trường headless)
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            file_path = filedialog.askopenfilename(
                title="Chọn chương trình thực thi (Executable)",
                filetypes=[("Chương trình thực thi (*.exe;*.bat;*.cmd)", "*.exe *.bat *.cmd"), ("Tất cả tệp", "*.*")]
            )
            root.destroy()

            if file_path:
                return {"success": True, "path": file_path}
            return {"success": False, "cancelled": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

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

    def grid_open_in_excel(self, columns=None, rows=None):
        try:
            import tempfile, os, datetime, uuid, ctypes
            columns = columns or []
            rows = rows or []

            temp_dir = os.path.join(tempfile.gettempdir(), "SqlGridExports")
            os.makedirs(temp_dir, exist_ok=True)
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            unique_id = uuid.uuid4().hex[:6]
            file_name = f"Export_{timestamp}_{unique_id}.xlsx"
            file_path = os.path.join(temp_dir, file_name)

            col_names = [c if isinstance(c, str) else c.get("name", str(c)) for c in columns]

            try:
                import openpyxl
                from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
                from openpyxl.utils import get_column_letter

                wb = openpyxl.Workbook()
                ws = wb.active
                ws.title = "Query Results"

                header_font = Font(name="Segoe UI", size=10, bold=True, color="1F1F1F")
                header_fill = PatternFill(start_color="E6E6E6", end_color="E6E6E6", fill_type="solid")
                thin_border = Border(
                    left=Side(style='thin', color='D4D4D4'),
                    right=Side(style='thin', color='D4D4D4'),
                    top=Side(style='thin', color='D4D4D4'),
                    bottom=Side(style='thin', color='D4D4D4')
                )

                for col_idx, col_name in enumerate(col_names, start=1):
                    cell = ws.cell(row=1, column=col_idx, value=col_name)
                    cell.font = header_font
                    cell.fill = header_fill
                    cell.border = thin_border
                    cell.alignment = Alignment(horizontal="left", vertical="center")

                cell_font = Font(name="Segoe UI", size=10, color="000000")
                null_font = Font(name="Segoe UI", size=10, italic=True, color="888888")
                null_fill = PatternFill(start_color="FFFFE1", end_color="FFFFE1", fill_type="solid")

                for r_idx, row in enumerate(rows, start=2):
                    for c_idx, val in enumerate(row, start=1):
                        cell = ws.cell(row=r_idx, column=c_idx)
                        cell.border = thin_border
                        if val is None:
                            cell.value = "NULL"
                            cell.font = null_font
                            cell.fill = null_fill
                        else:
                            cell.value = val
                            cell.font = cell_font

                if col_names:
                    last_col_letter = get_column_letter(len(col_names))
                    ws.auto_filter.ref = f"A1:{last_col_letter}{max(len(rows) + 1, 1)}"
                ws.freeze_panes = "A2"

                for col in ws.columns:
                    col_letter = get_column_letter(col[0].column)
                    sample = col[:100]
                    max_len = max([len(str(c.value or '')) for c in sample] or [10])
                    ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 50)

                wb.save(file_path)
            except Exception as excel_err:
                import csv
                file_path = file_path.replace(".xlsx", ".csv")
                with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(col_names)
                    for r in rows:
                        writer.writerow(["" if v is None else v for v in r])

            # Gán thuộc tính Read-Only cho file tạm
            try:
                ctypes.windll.kernel32.SetFileAttributesW(file_path, 1) # FILE_ATTRIBUTE_READONLY
            except Exception:
                try:
                    os.chmod(file_path, 0o444)
                except Exception:
                    pass

            os.startfile(file_path)
            return {"success": True, "file_path": file_path}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def grid_save_results_as(self, columns=None, rows=None, default_filename=None):
        try:
            import os, csv, json
            columns = columns or []
            rows = rows or []
            col_names = [c if isinstance(c, str) else c.get("name", str(c)) for c in columns]
            default_fn = default_filename or "Query_Results.xlsx"

            target_win = getattr(self, '_window', None)
            if not target_win and hasattr(self, '_main_api') and self._main_api:
                target_win = getattr(self._main_api, '_window', None)

            import webview
            if not target_win and hasattr(webview, 'windows') and webview.windows:
                target_win = webview.windows[0]

            file_path = None
            if target_win:
                try:
                    save_mode = getattr(webview.FileDialog, 'SAVE', getattr(webview, 'SAVE_DIALOG', 30))
                    files = target_win.create_file_dialog(
                        save_mode,
                        save_filename=default_fn,
                        file_types=(
                            'Excel Files (*.xlsx)',
                            'CSV Files (*.csv)',
                            'TSV Files (*.txt)',
                            'JSON Files (*.json)',
                            'All Files (*.*)'
                        )
                    )
                    if files and len(files) > 0:
                        file_path = files[0] if isinstance(files, (list, tuple)) else str(files)
                    else:
                        return {"success": False, "cancelled": True}
                except Exception as diag_err:
                    print(f"[SaveFileDialog Error] pywebview dialog error: {diag_err}, falling back to Tkinter")
                    file_path = None

            if not file_path:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                file_path = filedialog.asksaveasfilename(
                    initialfile=default_fn,
                    filetypes=[
                        ("Excel Files (*.xlsx)", "*.xlsx"),
                        ("CSV Files (*.csv)", "*.csv"),
                        ("TSV Files (*.txt)", "*.txt"),
                        ("JSON Files (*.json)", "*.json"),
                        ("All Files (*.*)", "*.*")
                    ]
                )
                root.destroy()
                if not file_path:
                    return {"success": False, "cancelled": True}

            ext = os.path.splitext(file_path)[1].lower()
            if not ext:
                ext = ".xlsx"
                file_path += ext

            if ext == ".xlsx":
                import openpyxl
                from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
                from openpyxl.utils import get_column_letter

                wb = openpyxl.Workbook()
                ws = wb.active
                ws.title = "Results"

                header_font = Font(name="Segoe UI", size=10, bold=True, color="1F1F1F")
                header_fill = PatternFill(start_color="E6E6E6", end_color="E6E6E6", fill_type="solid")
                thin_border = Border(
                    left=Side(style='thin', color='D4D4D4'),
                    right=Side(style='thin', color='D4D4D4'),
                    top=Side(style='thin', color='D4D4D4'),
                    bottom=Side(style='thin', color='D4D4D4')
                )

                for col_idx, col_name in enumerate(col_names, start=1):
                    cell = ws.cell(row=1, column=col_idx, value=col_name)
                    cell.font = header_font
                    cell.fill = header_fill
                    cell.border = thin_border
                    cell.alignment = Alignment(horizontal="left", vertical="center")

                cell_font = Font(name="Segoe UI", size=10, color="000000")
                null_font = Font(name="Segoe UI", size=10, italic=True, color="888888")
                null_fill = PatternFill(start_color="FFFFE1", end_color="FFFFE1", fill_type="solid")

                for r_idx, row in enumerate(rows, start=2):
                    for c_idx, val in enumerate(row, start=1):
                        cell = ws.cell(row=r_idx, column=c_idx)
                        cell.border = thin_border
                        if val is None:
                            cell.value = "NULL"
                            cell.font = null_font
                            cell.fill = null_fill
                        else:
                            cell.value = val
                            cell.font = cell_font

                if col_names:
                    last_col_letter = get_column_letter(len(col_names))
                    ws.auto_filter.ref = f"A1:{last_col_letter}{max(len(rows) + 1, 1)}"
                ws.freeze_panes = "A2"

                for col in ws.columns:
                    col_letter = get_column_letter(col[0].column)
                    sample = col[:100]
                    max_len = max([len(str(c.value or '')) for c in sample] or [10])
                    ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 50)

                wb.save(file_path)

            elif ext == ".csv":
                with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(col_names)
                    for row in rows:
                        writer.writerow(["" if val is None else val for val in row])

            elif ext in [".txt", ".tsv"]:
                with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.writer(f, delimiter="\t")
                    writer.writerow(col_names)
                    for row in rows:
                        writer.writerow(["" if val is None else val for val in row])

            elif ext == ".json":
                data_list = []
                for row in rows:
                    item = {}
                    for c_idx, col_name in enumerate(col_names):
                        item[col_name] = row[c_idx] if c_idx < len(row) else None
                    data_list.append(item)
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data_list, f, ensure_ascii=False, indent=2)

            return {"success": True, "saved_path": file_path}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def run_program(self, program_data):
        try:
            import subprocess, os
            if not program_data or not isinstance(program_data, dict):
                return {"success": False, "error": "Thiếu thông tin chương trình"}

            path = (program_data.get("path") or "").strip()
            if not path:
                return {"success": False, "error": "Đường dẫn chương trình không được để trống"}

            if not os.path.exists(path):
                return {"success": False, "error": f"Không tìm thấy file tại đường dẫn: {path}"}

            username = (program_data.get("username") or "").strip()
            password = program_data.get("password") or ""
            if password.startswith("ENC:"):
                password = decrypt_password(password)

            cmd = [path]
            if username:
                cmd.append(f"-u:{username}")
            if password:
                cmd.append(f"-p:{password}")

            work_dir = os.path.dirname(path) if os.path.isdir(os.path.dirname(path)) else None
            subprocess.Popen(cmd, cwd=work_dir)
            return {"success": True, "message": f"Đã khởi chạy: {program_data.get('name') or path}"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def open_settings_window(self):
        try:
            import webview
            settings = _load_settings_file()
            cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
            # NOTE: Do NOT append query parameters '?theme=...' to file:/// URIs in WebView2
            # because Windows file loader tries to find a file literally named with '?' on disk (ERR_FILE_NOT_FOUND).
            settings_html = (BASE_DIR / "templates" / "settings_window.html").resolve().as_uri()
            if hasattr(self, '_settings_window') and self._settings_window:
                try:
                    self._settings_window.show()
                    self._settings_window.focus()
                    return {"success": True}
                except Exception:
                    self._settings_window = None

            win_title = "Cài đặt (Settings) — luoBTool IDE"
            settings_api = SettingsSubwindowApi(self)
            settings_win = webview.create_window(
                title=win_title,
                url=settings_html,
                js_api=settings_api,
                width=1050,
                height=720,
                min_size=(800, 520),
                text_select=True
            )
            settings_api.set_window(settings_win)
            self._settings_window = settings_win

            # Áp dụng DWM Titlebar cho cửa sổ Cài đặt
            if getattr(self, '_current_titlebar_theme', None):
                t = self._current_titlebar_theme
                apply_dwm_titlebar_theme(settings_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
            else:
                apply_dwm_titlebar_theme(settings_win, bg=cur_theme, title=win_title)

            def on_closed():
                self._settings_window = None
                try:
                    import webview
                    if settings_win in webview.windows:
                        webview.windows.remove(settings_win)
                except Exception:
                    pass
            def on_loaded():
                try:
                    if getattr(self, '_current_titlebar_theme', None):
                        t = self._current_titlebar_theme
                        apply_dwm_titlebar_theme(settings_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
                    else:
                        apply_dwm_titlebar_theme(settings_win, bg=cur_theme, title=win_title)
                    settings_win.evaluate_js(
                        f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                        f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
                    )
                except Exception:
                    pass
            settings_win.events.closed += on_closed
            settings_win.events.loaded += on_loaded
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

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

    def open_profiler_window(self, conn_id=None, db_type=None):
        try:
            import webview
            settings = _load_settings_file()
            cur_theme = settings.get("theme") or settings.get("appearance", {}).get("theme", "dark")
            profiler_html = (BASE_DIR / "templates" / "profiler_window.html").resolve().as_uri()

            win_title = "SQL Trace Profiler — luoBTool IDE"
            profiler_api = ProfilerSubwindowApi(self)
            profiler_win = webview.create_window(
                title=win_title,
                url=profiler_html,
                js_api=profiler_api,
                width=1320,
                height=840,
                min_size=(920, 560),
                text_select=True
            )
            profiler_api.set_window(profiler_win)
            if not hasattr(self, '_profiler_windows') or self._profiler_windows is None:
                self._profiler_windows = []
            self._profiler_windows.append(profiler_win)

            # Áp dụng DWM Titlebar cho cửa sổ Profiler
            if getattr(self, '_current_titlebar_theme', None):
                t = self._current_titlebar_theme
                apply_dwm_titlebar_theme(profiler_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
            else:
                apply_dwm_titlebar_theme(profiler_win, bg=cur_theme, title=win_title)

            def on_closed():
                if profiler_win in getattr(self, '_profiler_windows', []):
                    self._profiler_windows.remove(profiler_win)
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

            def on_loaded():
                try:
                    if getattr(self, '_current_titlebar_theme', None):
                        t = self._current_titlebar_theme
                        apply_dwm_titlebar_theme(profiler_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
                    else:
                        apply_dwm_titlebar_theme(profiler_win, bg=cur_theme, title=win_title)
                    init_js = (
                        f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                        f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }} "
                    )
                    if conn_id and not str(conn_id).startswith("__group__"):
                        init_js += f"if (window.onProfilerInitConn) {{ window.onProfilerInitConn('{conn_id}'); }}"
                    profiler_win.evaluate_js(init_js)
                except Exception:
                    pass

            profiler_win.events.closed += on_closed
            profiler_win.events.loaded += on_loaded
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def profiler_list_connections(self):
        try:
            saved = _read_json(CONNECTIONS_FILE, [])
            sanitized_saved = []
            for d in saved:
                item = dict(d)
                db_type = (item.get("type") or "").strip().lower()
                if db_type == "group_marker" or str(item.get("name", "")).startswith("__group__"):
                    continue
                item["supported"] = db_type in ("sqlserver", "mssql", "sql_server", "postgres", "postgresql", "pgsql")
                if item.get("password"):
                    item["has_password"] = True
                    item.pop("password", None)
                else:
                    item["has_password"] = False
                sanitized_saved.append(item)
            return {"success": True, "connections": sanitized_saved}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def profiler_start_trace(self, conn_id=None, conn_config=None, target_win=None):
        try:
            from app.services.profiler import profiler_service

            target_cfg = None
            if conn_config and isinstance(conn_config, dict):
                target_cfg = dict(conn_config)
            elif conn_id:
                saved = _read_json(CONNECTIONS_FILE, [])
                for p in saved:
                    if p.get("id") == conn_id or str(p.get("name", "")).strip().lower() == str(conn_id).strip().lower():
                        target_cfg = dict(p)
                        break

            if not target_cfg:
                return {"success": False, "error": f"Không tìm thấy cấu hình kết nối {conn_id}"}

            db_t = (target_cfg.get("type") or "").lower()
            if db_t == "group_marker" or str(target_cfg.get("name", "")).startswith("__group__"):
                return {"success": False, "error": "Không thể bắt đầu trace trên nhóm."}

            if target_cfg.get("password"):
                target_cfg["password"] = decrypt_password(target_cfg["password"])
            elif not target_cfg.get("password") and target_cfg.get("id"):
                pwd = self.cm.get_cached_password(target_cfg)
                if pwd:
                    target_cfg["password"] = pwd

            if not target_win:
                if hasattr(self, '_profiler_windows') and self._profiler_windows:
                    target_win = self._profiler_windows[-1]
                if not target_win:
                    target_win = getattr(self, '_window', None)

            res = profiler_service.start_trace(target_cfg, target_window=target_win)
            return res
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def profiler_pause_trace(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.pause_trace(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def profiler_resume_trace(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.resume_trace(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def profiler_stop_trace(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.stop_trace(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def profiler_get_status(self, session_id):
        try:
            from app.services.profiler import profiler_service
            return profiler_service.get_status(session_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def _broadcast_settings(self, settings):
        def _do_broadcast():
            try:
                import webview, json
                theme = settings.get("appearance", {}).get("theme") or settings.get("theme", "dark")
                # Đồng bộ màu thanh tiêu đề Windows qua DWM
                try:
                    self.apply_titlebar_theme(theme)
                except Exception:
                    pass

                # NOTE: persist=false to prevent infinite recursive save loops!
                js_broadcast = (
                    f"if (window.onSettingsChanged) {{ window.onSettingsChanged({json.dumps(settings)}); }} "
                    f"else if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{theme}', false); }} "
                    f"else {{ document.documentElement.setAttribute('data-bs-theme', '{theme}'); }}"
                )

                # Collect active window instances
                targets = []
                if getattr(self, '_window', None):
                    targets.append(self._window)
                if getattr(self, '_settings_window', None):
                    targets.append(self._settings_window)
                for bw in getattr(self, '_bravo_windows', []):
                    if bw and bw not in targets:
                        targets.append(bw)
                for pw in getattr(self, '_profiler_windows', []):
                    if pw and pw not in targets:
                        targets.append(pw)

                for w in getattr(webview, 'windows', []):
                    if w and w not in targets:
                        targets.append(w)

                for w in targets:
                    try:
                        gui = getattr(w, 'gui', None)
                        if gui is not None:
                            # In WinForms, gui is a Form. Skip if already disposed or closing
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

    def save_settings(self, settings):
        success = _save_settings_file(settings)
        self._broadcast_settings(settings)
        return {"success": success}

    def get_saved_connections(self):
        data = _read_json(CONNECTIONS_FILE, [])
        for d in data:
            if d.get("password"):
                d["has_password"] = True
                d.pop("password", None)
            else:
                d["has_password"] = False
        return {"success": True, "connections": data}

    def get_connection_password(self, profile_id_or_name):
        try:
            saved = _read_json(CONNECTIONS_FILE, [])
            target_str = str(profile_id_or_name).strip().lower()
            for p in saved:
                if p.get("id") == profile_id_or_name or str(p.get("name", "")).strip().lower() == target_str:
                    if p.get("password"):
                        return {"success": True, "password": decrypt_password(p["password"])}
                    break
            return {"success": True, "password": ""}
        except Exception as exc:
            return {"success": False, "error": str(exc), "password": ""}

    def save_connection_profile(self, profile):
        profiles = _read_json(CONNECTIONS_FILE, [])
        prof = dict(profile)
        prof_id = prof.get("id")

        matched_idx = -1
        if prof_id:
            for i, p in enumerate(profiles):
                if p.get("id") == prof_id:
                    matched_idx = i
                    break

        if matched_idx == -1 and prof.get("name"):
            p_name = str(prof.get("name")).strip().lower()
            p_type = str(prof.get("type", "")).strip().lower()
            for i, p in enumerate(profiles):
                if str(p.get("name")).strip().lower() == p_name and str(p.get("type", "")).strip().lower() == p_type:
                    matched_idx = i
                    break

        if matched_idx == -1 and (prof.get("server") or prof.get("host")):
            p_srv = str(prof.get("server") or prof.get("host")).strip().lower()
            p_port = str(prof.get("port") or "")
            p_db = str(prof.get("database") or "").strip().lower()
            p_type = str(prof.get("type", "")).strip().lower()
            for i, p in enumerate(profiles):
                e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                e_port = str(p.get("port") or "")
                e_db = str(p.get("database") or "").strip().lower()
                e_type = str(p.get("type", "")).strip().lower()
                if e_srv == p_srv and e_port == p_port and e_db == p_db and e_type == p_type:
                    matched_idx = i
                    break

        # Password encryption & preservation in connections.json
        pwd = prof.get("password")
        clear_pwd = prof.pop("clear_password", False)
        if clear_pwd:
            prof.pop("password", None)
            prof["has_password"] = False
        elif pwd:
            prof["password"] = encrypt_password(pwd)
            prof["has_password"] = True
        elif matched_idx >= 0 and profiles[matched_idx].get("password"):
            prof["password"] = profiles[matched_idx]["password"]
            prof["has_password"] = True
        else:
            prof.pop("password", None)
            prof["has_password"] = False

        if matched_idx >= 0:
            if not prof_id:
                prof["id"] = profiles[matched_idx].get("id") or f"conn_{uuid.uuid4().hex[:8]}"
            profiles[matched_idx] = prof
        else:
            if not prof_id:
                prof["id"] = f"conn_{uuid.uuid4().hex[:8]}"
            profiles.append(prof)

        _write_json(CONNECTIONS_FILE, profiles)
        return {"success": True, "connection": prof}

    def delete_saved_connection_profile(self, profile_id):
        profiles = _read_json(CONNECTIONS_FILE, [])
        new_profiles = [p for p in profiles if p.get("id") != profile_id]
        _write_json(CONNECTIONS_FILE, new_profiles)
        return {"success": True}

    def create_connection(self, config):
        if not config.get("type"):
            return {"success": False, "error": "Database type is required"}
        db_type = (config.get("type") or "").strip().lower()
        if db_type == "group_marker" or str(config.get("name", "")).startswith("__group__"):
            return {"success": False, "error": "Không thể kết nối đến nhóm. Vui lòng chọn một kết nối cơ sở dữ liệu."}
        try:
            cfg = dict(config)
            # If password not provided in payload and authentication requires password, load from connections.json
            if not cfg.get("password") and not cfg.get("trusted_connection") and (cfg.get("type") or "").lower() != "sqlite":
                saved = _read_json(CONNECTIONS_FILE, [])
                target = None
                prof_id = cfg.get("id")
                if prof_id:
                    for p in saved:
                        if p.get("id") == prof_id:
                            target = p
                            break
                if not target and cfg.get("name"):
                    c_name = str(cfg.get("name")).strip().lower()
                    c_type = str(cfg.get("type", "")).strip().lower()
                    for p in saved:
                        if str(p.get("name")).strip().lower() == c_name and str(p.get("type", "")).strip().lower() == c_type:
                            target = p
                            break
                if not target and (cfg.get("server") or cfg.get("host")):
                    c_srv = str(cfg.get("server") or cfg.get("host")).strip().lower()
                    c_port = str(cfg.get("port") or "")
                    for p in saved:
                        e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                        e_port = str(p.get("port") or "")
                        if e_srv == c_srv and e_port == c_port:
                            target = p
                            break

                if target and target.get("password"):
                    cfg["password"] = decrypt_password(target["password"])
                else:
                    return {"success": False, "error": "Mật khẩu là bắt buộc cho kết nối này. Vui lòng nhập mật khẩu."}

            conn, reused = self.cm.create_or_get(self.owner_session_id, cfg)
            return {"success": True, "connection": conn.public_info(), "reused": reused}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def list_connections(self):
        try:
            saved = _read_json(CONNECTIONS_FILE, [])
            sanitized_saved = []
            for d in saved:
                item = dict(d)
                db_type = (item.get("type") or "").strip().lower()
                if db_type == "group_marker" or str(item.get("name", "")).startswith("__group__"):
                    continue
                if item.get("password"):
                    item["has_password"] = True
                    item.pop("password", None)
                else:
                    item["has_password"] = False
                sanitized_saved.append(item)
            items = [c.public_info() for c in self.cm.list(self.owner_session_id)]
            return {
                "success": True,
                "connections": items,
                "saved_connections": sanitized_saved,
                "active_connections": items
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def delete_connection(self, connection_id):
        try:
            self.cm.close(self.owner_session_id, connection_id)
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def check_credential(self, config):
        db_type = (config.get("type") or "sqlserver").lower()
        if db_type == "group_marker" or str(config.get("name", "")).startswith("__group__"):
            return {"success": False, "error": "Không phải kết nối cơ sở dữ liệu."}
        trusted = bool(config.get("trusted_connection"))
        if db_type == "sqlite" or trusted:
            return {"success": True, "requires_password": False, "has_password": True}

        # Check directly in connections.json file (source of truth)
        saved = _read_json(CONNECTIONS_FILE, [])
        target = None
        prof_id = config.get("id")
        if prof_id:
            for p in saved:
                if p.get("id") == prof_id:
                    target = p
                    break
        if not target and config.get("name"):
            c_name = str(config.get("name")).strip().lower()
            c_type = str(config.get("type", "")).strip().lower()
            for p in saved:
                if str(p.get("name")).strip().lower() == c_name and str(p.get("type", "")).strip().lower() == c_type:
                    target = p
                    break
        if not target and (config.get("server") or config.get("host")):
            c_srv = str(config.get("server") or config.get("host")).strip().lower()
            c_port = str(config.get("port") or "")
            for p in saved:
                e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                e_port = str(p.get("port") or "")
                if e_srv == c_srv and e_port == c_port:
                    target = p
                    break

        if target and target.get("password"):
            return {"success": True, "requires_password": True, "has_password": True}

        return {"success": True, "requires_password": True, "has_password": False}

    def clear_credential(self, config):
        self.cm.clear_cached_password(config)
        return {"success": True}

    def fetch_connection_metadata(self, config):
        try:
            cfg = dict(config or {})
            if not cfg.get("password") and not cfg.get("trusted_connection") and (cfg.get("type") or "").lower() != "sqlite":
                saved = _read_json(CONNECTIONS_FILE, [])
                target = None
                prof_id = cfg.get("id")
                if prof_id:
                    for p in saved:
                        if p.get("id") == prof_id:
                            target = p
                            break
                if not target and cfg.get("name"):
                    c_name = str(cfg.get("name")).strip().lower()
                    c_type = str(cfg.get("type", "")).strip().lower()
                    for p in saved:
                        if str(p.get("name")).strip().lower() == c_name and str(p.get("type", "")).strip().lower() == c_type:
                            target = p
                            break
                if not target and (cfg.get("server") or cfg.get("host")):
                    c_srv = str(cfg.get("server") or cfg.get("host")).strip().lower()
                    c_port = str(cfg.get("port") or "")
                    for p in saved:
                        e_srv = str(p.get("server") or p.get("host") or "").strip().lower()
                        e_port = str(p.get("port") or "")
                        if e_srv == c_srv and e_port == c_port:
                            target = p
                            break

                if target and target.get("password"):
                    cfg["password"] = decrypt_password(target["password"])

            temp_conn = self.cm.create(self.owner_session_id, cfg)
            try:
                db_name = cfg.get("database") or None
                databases = []
                schemas = []
                try:
                    raw_dbs = temp_conn.metadata_service.list_databases()
                    databases = [d.get("name", d) if isinstance(d, dict) else str(d) for d in raw_dbs]
                except Exception:
                    pass
                try:
                    raw_schemas = temp_conn.metadata_service.list_schemas(db_name)
                    schemas = [s.get("name", s) if isinstance(s, dict) else str(s) for s in raw_schemas]
                except Exception:
                    pass
                return {"success": True, "databases": databases, "schemas": schemas}
            finally:
                self.cm.close(self.owner_session_id, temp_conn.connection_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def _get_connection(self, connection_id):
        with self.cm._lock:
            conn = self.cm._connections.get(connection_id)
            if conn:
                conn.touch()
                return conn
        return self.cm.get(self.owner_session_id, connection_id)

    def get_databases(self, connection_id, search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_databases()
            if search:
                s = search.strip().lower()
                items = [d for d in items if s in (d.get("name", d) if isinstance(d, dict) else str(d)).lower()]
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_schemas(self, connection_id, database=None, search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_schemas(database)
            if search:
                s = search.strip().lower()
                items = [x for x in items if s in (x.get("name", x) if isinstance(x, dict) else str(x)).lower()]
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def create_session(self, config=None, connection_id=None, window_id=None):
        wid = window_id or str(uuid.uuid4())
        sid = f"bravo_{uuid.uuid4().hex[:12]}"
        self._bravo_sessions[sid] = {
            "connection_id": connection_id,
            "window_id": wid,
            "config": config
        }
        return {"success": True, "bravo_session_id": sid, "window_id": wid}

    def destroy_session(self, bravo_session_id):
        if bravo_session_id in self._bravo_sessions:
            del self._bravo_sessions[bravo_session_id]
            return {"success": True}
        return {"success": False, "error": "Session not found"}

    def get_session(self, bravo_session_id):
        sess = self._bravo_sessions.get(bravo_session_id)
        if not sess:
            return {"success": False, "error": "Session not found"}
        return {"success": True, "session": sess}

    def layout_editor_list(self, connection_id, database=None, platform="Win", version="Bravo 10", custom_where=""):
        if not connection_id:
            return {"success": False, "error": "connection_id is required"}

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            if is_postgres:
                if platform == "Win":
                    if version == "Bravo 7":
                        sql = """SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", l.istemplate AS "IsTemplate",
                                        l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy", 0 AS "HasDraft",
                                        c.commandkey AS "CommandKey", c.dllname AS "DllName", c.classname AS "ClassName"
                                 FROM b00layout AS l
                                 INNER JOIN b00layoutdata AS ld ON ld.id = l.id
                                 LEFT OUTER JOIN b00command AS c ON c.ctorarg2 = l.formname
                                 LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby"""
                    else:
                        sql = """SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", l.istemplate AS "IsTemplate",
                                        l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy",
                                        CASE WHEN ld.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(ld.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft",
                                        c.commandkey AS "CommandKey", c.dllname AS "DllName", c.classname AS "ClassName"
                                 FROM b00layout AS l
                                 INNER JOIN b00layoutdata AS ld ON ld.id = l.id
                                 LEFT OUTER JOIN b00command AS c ON c.commandkey = l.formname
                                 LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby"""
                else:
                    if version == "Bravo 8":
                        sql = """SELECT id AS "Id", name AS "FormName", '' AS "LayoutName", 0 AS "IsTemplate", NULL AS "CreatedBy",
                                        modifiedat AS "ModifiedAt", NULL AS "ModifiedBy", 0 AS "HasDraft",
                                        name AS "CommandKey", '' AS "DllName", '' AS "ClassName"
                                 FROM b00storyboard"""
                    else:
                        sql = """SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", 0 AS "IsTemplate",
                                        l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy",
                                        CASE WHEN ld.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(ld.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft",
                                        c.commandkey AS "CommandKey", c.dllname AS "DllName", c.classname AS "ClassName"
                                 FROM b09layout AS l
                                 INNER JOIN b09layoutdata AS ld ON ld.id = l.id
                                 LEFT OUTER JOIN b09command AS c ON c.commandkey = l.formname
                                 LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby"""
            else:
                if platform == "Win":
                    if version == "Bravo 7":
                        sql = """SELECT l.Id, l.FormName, l.LayoutName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy, 0 AS HasDraft,
                                        c.CommandKey, c.DllName, c.ClassName
                                 FROM B00Layout AS l
                                 INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id
                                 LEFT OUTER JOIN B00Command AS c ON c.CtorArg2 = l.FormName
                                 LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy"""
                    else:
                        sql = """SELECT l.Id, l.FormName, l.LayoutName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy,
                                        CASE WHEN ld.LastLayoutData IS NOT NULL AND DATALENGTH(ld.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft,
                                        c.CommandKey, c.DllName, c.ClassName
                                 FROM B00Layout AS l
                                 INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id
                                 LEFT OUTER JOIN B00Command AS c ON c.CommandKey = l.FormName
                                 LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy"""
                else:
                    if version == "Bravo 8":
                        sql = """SELECT Id, Name AS FormName, '' AS LayoutName, 0 AS IsTemplate, NULL AS CreatedBy, ModifiedAt, NULL AS ModifiedBy, 0 AS HasDraft,
                                        Name AS CommandKey, '' AS DllName, '' AS ClassName
                                 FROM B00StoryBoard"""
                    else:
                        sql = """SELECT l.Id, l.FormName, l.LayoutName, 0 AS IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy,
                                        CASE WHEN ld.LastLayoutData IS NOT NULL AND DATALENGTH(ld.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft,
                                        c.CommandKey, c.DllName, c.ClassName
                                 FROM B09Layout AS l
                                 INNER JOIN B09LayoutData AS ld ON ld.Id = l.Id
                                 LEFT OUTER JOIN B09Command AS c ON c.CommandKey = l.FormName
                                 LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy"""

            if custom_where and custom_where.strip():
                cw = custom_where.strip()
                if not cw.upper().startswith("WHERE"):
                    sql += f" WHERE 1=1 {cw}"
                else:
                    sql += f" {cw}"

            order_col = "l.formname" if is_postgres else "l.FormName"
            sql += f" ORDER BY {order_col}"

            result = conn.query_service.execute(sql, limit=5000, database=database)
            if not result.get("success", False):
                return result

            rows = result.get("rows", [])
            columns = result.get("columns", [])
            template_map = {0: "Layout", 1: "FormTemplate", 2: "GlobalLayout", 3: "Datasource", 4: "SubLayout"}

            items = []
            for r in rows:
                col_map = {str(col).lower(): val for col, val in zip(columns, r)}
                is_tpl = col_map.get("istemplate", 0) or 0
                items.append({
                    "id": col_map.get("id"),
                    "formName": col_map.get("formname", "") or "",
                    "layoutName": col_map.get("layoutname", "") or "",
                    "layoutType": template_map.get(is_tpl, "Khác"),
                    "isTemplate": is_tpl,
                    "createdBy": col_map.get("createdby", "") or "",
                    "modifiedAt": str(col_map.get("modifiedat", "")) if col_map.get("modifiedat") else "",
                    "modifiedBy": col_map.get("modifiedby", "") or "",
                    "hasDraft": bool(col_map.get("hasdraft", 0)),
                    "commandKey": col_map.get("commandkey", "") or "",
                    "dllName": col_map.get("dllname", "") or "",
                    "className": col_map.get("classname", "") or "",
                })

            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def layout_editor_payload(self, connection_id, form_id, database=None, platform="Win", version="Bravo 10"):
        if not connection_id or form_id is None:
            return {"success": False, "error": "connection_id and form id are required"}

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            if platform == "Win":
                tbl = "b00layoutdata" if is_postgres else "B00LayoutData"
                sql = f"SELECT Id, LayoutData, LastLayoutData FROM {tbl} WHERE Id = {int(form_id)}"
            else:
                if version == "Bravo 8":
                    tbl = "b00storyboard" if is_postgres else "B00StoryBoard"
                    sql = f"SELECT Id, LayoutXml AS LayoutData, NULL AS LastLayoutData FROM {tbl} WHERE Id = {int(form_id)}"
                else:
                    tbl = "b09layoutdata" if is_postgres else "B09LayoutData"
                    sql = f"SELECT Id, LayoutData, LastLayoutData FROM {tbl} WHERE Id = {int(form_id)}"

            result = conn.query_service.execute(sql, database=database)
            if not result.get("success", False) or not result.get("rows"):
                return {"success": False, "error": "Record not found"}

            row = result["rows"][0]
            raw_xml = row[1] if len(row) > 1 else ""
            raw_draft = row[2] if len(row) > 2 else ""

            xml_content = _decode_xml_payload(raw_xml, version)
            draft_xml_content = _decode_xml_payload(raw_draft, version) if raw_draft else ""

            return {
                "success": True,
                "id": form_id,
                "xml": xml_content,
                "draft_xml": draft_xml_content
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def layout_editor_commit(self, connection_id, forms, database=None, platform="Win", version="Bravo 10"):
        if not connection_id or not forms:
            return {"success": False, "error": "connection_id and forms list are required"}

        # 1. Pre-commit XML Syntax Validation
        for item in forms:
            xml_str = item.get("xml", "")
            valid, err = _validate_xml_syntax(xml_str)
            if not valid:
                return {
                    "success": False,
                    "error": f"Cú pháp XML không hợp lệ tại form '{item.get('formName')}': {err}"
                }

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            def _format_binary_literal(binary_data):
                if not binary_data:
                    return "NULL"
                hex_str = binary_data.hex()
                if is_postgres:
                    return f"decode('{hex_str}', 'hex')"
                return f"0x{hex_str}"

            time_fn = "CURRENT_TIMESTAMP" if is_postgres else "GETDATE()"

            # 2. Build Atomic Transaction Script
            statements = ["BEGIN TRANSACTION;"]
            for item in forms:
                f_id = int(item.get("id"))
                xml_str = item.get("xml", "")
                draft_xml_str = item.get("draft_xml")

                if platform == "Mobile" and version == "Bravo 8":
                    xml_escaped = xml_str.replace("'", "''")
                    tbl_sb = "b00storyboard" if is_postgres else "B00StoryBoard"
                    statements.append(f"UPDATE {tbl_sb} SET LayoutXml = '{xml_escaped}', ModifiedAt = {time_fn} WHERE Id = {f_id};")
                else:
                    zip_bytes = _encode_xml_payload(xml_str, version=version, format_type="zip")
                    bin_lit = _format_binary_literal(zip_bytes)
                    set_clause = f"LayoutData = {bin_lit}"

                    if draft_xml_str is not None:
                        draft_bytes = _encode_xml_payload(draft_xml_str, version=version, format_type="zip")
                        draft_bin_lit = _format_binary_literal(draft_bytes)
                        set_clause += f", LastLayoutData = {draft_bin_lit}"

                    if is_postgres:
                        table_data = "b00layoutdata" if platform == "Win" else "b09layoutdata"
                        table_main = "b00layout" if platform == "Win" else "b09layout"
                    else:
                        table_data = "B00LayoutData" if platform == "Win" else "B09LayoutData"
                        table_main = "B00Layout" if platform == "Win" else "B09Layout"

                    statements.append(f"UPDATE {table_data} SET {set_clause} WHERE Id = {f_id};")
                    statements.append(f"UPDATE {table_main} SET ModifiedAt = {time_fn} WHERE Id = {f_id};")

            statements.append("COMMIT TRANSACTION;")
            full_sql = "\n".join(statements)

            result = conn.query_service.execute(full_sql, database=database)
            if not result.get("success", False):
                return result

            return {"success": True, "count": len(forms), "message": "Commit successful!"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def layout_editor_search_xml(self, connection_id, keyword, form_ids=None, database=None, platform="Win", version="Bravo 10", is_regex=False):
        if not connection_id or not keyword:
            return {"success": False, "error": "connection_id and keyword are required"}
        if not form_ids:
            return {"success": True, "results": []}

        import re as _re
        ids_str = ", ".join(str(int(fid)) for fid in form_ids)

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            if platform == "Win":
                tbl = "b00layoutdata" if is_postgres else "B00LayoutData"
                sql = f"SELECT Id, LayoutData FROM {tbl} WHERE Id IN ({ids_str})"
            else:
                if version == "Bravo 8":
                    tbl = "b00storyboard" if is_postgres else "B00StoryBoard"
                    sql = f"SELECT Id, LayoutXml AS LayoutData FROM {tbl} WHERE Id IN ({ids_str})"
                else:
                    tbl = "b09layoutdata" if is_postgres else "B09LayoutData"
                    sql = f"SELECT Id, LayoutData FROM {tbl} WHERE Id IN ({ids_str})"

            result = conn.query_service.execute(sql, database=database)
            if not result.get("success", False):
                return {"success": False, "error": result.get("error", "Query failed")}

            rows = result.get("rows", [])
            matched = []

            for r in rows:
                fid = r[0]
                raw_val = r[1] if len(r) > 1 else ""
                xml_str = _decode_xml_payload(raw_val, version)
                if not xml_str:
                    continue

                lines = xml_str.splitlines()
                hits = []
                for idx, line in enumerate(lines):
                    if is_regex:
                        try:
                            if _re.search(keyword, line, _re.IGNORECASE):
                                hits.append({"line": idx + 1, "content": line.strip()[:150]})
                        except Exception:
                            if keyword.lower() in line.lower():
                                hits.append({"line": idx + 1, "content": line.strip()[:150]})
                    else:
                        if keyword.lower() in line.lower():
                            hits.append({"line": idx + 1, "content": line.strip()[:150]})

                if hits:
                    matched.append({
                        "id": fid,
                        "match_count": len(hits),
                        "snippets": hits[:10]
                    })

            return {"success": True, "results": matched}
        except Exception as exc:
            return {"success": False, "error": str(exc)}



    # Metadata & Object Explorer Methods
    def get_objects(self, connection_id, database=None, schema=None, type="tables", search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_objects(database, schema, type, search)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_definition(self, connection_id, database=None, schema=None, name=None, type=None):
        try:
            conn = self._get_connection(connection_id)
            val = conn.metadata_service.get_object_definition(database, schema, name, type)
            return {"success": True, "definition": val}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_object_children(self, connection_id, database=None, schema=None, name=None, type=None, child_type=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_object_children(database, schema, name, type, child_type)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # Table Designer Methods
    def get_table_design(self, connection_id, database=None, schema=None, table=None):
        try:
            if not table:
                return {"success": False, "error": "Parameter 'table' is required"}
            conn = self._get_connection(connection_id)
            data = conn.metadata_service.get_table_design_metadata(database, schema, table)
            if not data:
                return {"success": False, "error": f"Table {schema}.{table} not found"}
            preview_sql = TableDesignerService.generate_create_table_ddl(data)
            return {"success": True, "data": data, "preview_sql": preview_sql}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_table_design_types(self, connection_id, database=None):
        try:
            conn = self._get_connection(connection_id)
            types_info = conn.metadata_service.get_supported_types(database=database)
            return {"success": True, "data": types_info}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def preview_table_design(self, connection_id, data=None):
        try:
            preview_sql = TableDesignerService.generate_create_table_ddl(data or {})
            return {"success": True, "preview_sql": preview_sql}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def diff_table_design(self, connection_id, original=None, modified=None):
        try:
            diff_res = TableDesignerService.generate_diff(original or {}, modified or {})
            new_preview = TableDesignerService.generate_create_table_ddl(modified or {})
            return {"success": True, "diff": diff_res, "preview_sql": new_preview}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def apply_table_design(self, connection_id, database=None, statements=None, migration_sql=None):
        try:
            conn = self._get_connection(connection_id)
            batches = []
            if migration_sql and migration_sql.strip():
                raw_batches = re.split(r'^\s*GO\s*;?\s*(?:--.*)?$', migration_sql, flags=re.MULTILINE | re.IGNORECASE)
                batches = [b.strip() for b in raw_batches if b.strip()]
            elif statements:
                for stmt in statements:
                    sql = stmt.get("sql") if isinstance(stmt, dict) else str(stmt)
                    if sql and sql.strip():
                        batches.append(sql.strip())
            if not batches:
                return {"success": False, "error": "No statements provided to apply"}
            conn.adapter.execute_migration_transaction(batches, database=database)
            conn.metadata_service.invalidate()
            return {"success": True, "message": "Changes applied successfully"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # Intellisense Methods
    def get_intellisense_objects(self, connection_id, database=None, schema=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_intellisense_objects(database, schema)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_intellisense_columns(self, connection_id, database=None, schema=None, table=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_intellisense_columns(database, schema, table)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_intellisense_parameters(self, connection_id, database=None, schema=None, name=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_intellisense_parameters(database, schema, name)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_intellisense_types(self, connection_id, database=None):
        try:
            conn = self._get_connection(connection_id)
            types_info = conn.metadata_service.get_supported_types(database=database)
            return {
                "success": True,
                "types": types_info.get("types", []),
                "user_types": types_info.get("user_types", []),
                "engine": types_info.get("engine", "")
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}



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

class MainApi(BravoApi):
    def __init__(self, cm: ConnectionManager = connection_manager):
        super().__init__(cm, owner_session_id="desktop_user")
        self._window = None
        self._bravo_windows = []
        self._profiler_windows = []
        self._on_ready_callback = None

    def set_window(self, win):
        super().set_window(win)
        self._window = win

    def notify_app_ready(self):
        """Called by frontend once DOM, Monaco, Explorer and Theme are fully loaded."""
        if hasattr(self, '_on_ready_callback') and callable(self._on_ready_callback):
            self._on_ready_callback()
        return {"success": True}

    # Window controls inherited from BravoApi


    def open_bravo_window(self, conn_id=None, conn_name=None, database=None, db_type=None, schema=None):
        try:
            bravo_html = (BASE_DIR / "templates" / "bravo_form.html").resolve().as_uri()

            if conn_name and str(conn_name).startswith("__group__"):
                conn_name = None
                conn_id = None
                database = None
                schema = None

            # Window title: "{conn_name} - {database} - BRAVO Tool"
            if conn_name and database and database != "—":
                win_title = f"{conn_name} - {database} - BRAVO Tool"
            elif conn_name and conn_name != "Chưa kết nối" and conn_name != "No connection":
                win_title = f"{conn_name} - BRAVO Tool"
            else:
                win_title = "BRAVO Tool — Layout XML Editor"

            full_url = bravo_html

            bravo_sess_id = f"bravo_user_{uuid.uuid4().hex[:8]}"
            # Fallback schema if not specified
            eff_schema = schema
            if not eff_schema and database and database != "—":
                eff_schema = "public" if (db_type or "").lower() == "postgresql" else "dbo"

            bravo_api = BravoApi(
                self.cm,
                owner_session_id=bravo_sess_id,
                initial_context={
                    "connection_id": conn_id,
                    "connection_name": conn_name,
                    "database": database,
                    "db_type": db_type,
                    "schema": eff_schema
                },
                main_api=self
            )
            settings = _load_settings_file()
            cur_theme = settings.get("appearance", {}).get("theme") or settings.get("theme", "dark")
            bg_color = "#ffffff" if cur_theme in ["light", "win-nt", "win-xp"] else "#1e1e1e"

            bravo_win = webview.create_window(
                title=win_title,
                url=full_url,
                js_api=bravo_api,
                width=1280,
                height=820,
                min_size=(950, 650),
                hidden=True,
                background_color=bg_color,
                text_select=True
            )
            bravo_api.set_window(bravo_win)

            # Áp dụng DWM Titlebar cho cửa sổ BRAVO Tool
            if getattr(self, '_current_titlebar_theme', None):
                t = self._current_titlebar_theme
                apply_dwm_titlebar_theme(bravo_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
            else:
                apply_dwm_titlebar_theme(bravo_win, bg=cur_theme, title=win_title)

            def on_bravo_closed():
                if bravo_win in self._bravo_windows:
                    self._bravo_windows.remove(bravo_win)
                try:
                    import webview
                    if bravo_win in webview.windows:
                        webview.windows.remove(bravo_win)
                except Exception:
                    pass
                self.cm.close_all(bravo_sess_id)
            bravo_win.events.closed += on_bravo_closed
            self._bravo_windows.append(bravo_win)

            def on_bravo_loaded():
                try:
                    if getattr(self, '_current_titlebar_theme', None):
                        t = self._current_titlebar_theme
                        apply_dwm_titlebar_theme(bravo_win, bg=t.get("bg"), text=t.get("text"), border=t.get("border"), is_dark=t.get("is_dark"), title=win_title)
                    else:
                        apply_dwm_titlebar_theme(bravo_win, bg=cur_theme, title=win_title)
                    bravo_win.evaluate_js(
                        f"if (window.ThemeManager) {{ window.ThemeManager.applyTheme('{cur_theme}', false); }} "
                        f"else {{ document.documentElement.setAttribute('data-bs-theme', '{cur_theme}'); }}"
                    )
                except Exception:
                    pass
            bravo_win.events.loaded += on_bravo_loaded

            # Fallback timer: đảm bảo cửa sổ luôn hiển thị nếu frontend gặp sự cố không gọi ready()
            import threading
            threading.Timer(1.5, lambda: (bravo_win.show() if bravo_win else None)).start()

            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # Metadata API for Object Explorer & Table Designer
    def get_tables(self, connection_id, database=None, schema=None, search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_tables(database, schema)
            if search:
                s = search.strip().lower()
                items = [t for t in items if s in (t.get("name", t) if isinstance(t, dict) else str(t)).lower()]
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_table_columns(self, connection_id, database=None, schema=None, table_name=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_columns(table_name, database, schema)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_table_designer_metadata(self, connection_id, database=None, schema=None, table_name=None):
        try:
            conn = self._get_connection(connection_id)
            td_service = TableDesignerService(conn.adapter)
            meta = td_service.get_metadata(database, schema, table_name)
            return {"success": True, "metadata": meta}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def table_designer_script(self, connection_id, payload):
        try:
            conn = self._get_connection(connection_id)
            td_service = TableDesignerService(conn.adapter)
            script = td_service.generate_script(payload)
            return {"success": True, "script": script}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def table_designer_save(self, connection_id, payload):
        try:
            conn = self._get_connection(connection_id)
            td_service = TableDesignerService(conn.adapter)
            result = td_service.apply_changes(payload)
            return {"success": True, "result": result}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # Query Execution API
    def execute_query(self, connection_id, sql, limit=1000, database=None, schema=None):
        try:
            conn = self._get_connection(connection_id)
            result = conn.query_service.execute(sql, limit=limit, database=database, schema=schema)
            return {"success": True, **result}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def explain_query(self, connection_id, sql, database=None):
        try:
            conn = self._get_connection(connection_id)
            adapter = conn.adapter
            db_type = getattr(adapter, "db_type", "sqlserver").lower()

            if db_type == "postgresql":
                exp_sql = f"EXPLAIN (FORMAT TEXT) {sql}"
                result = conn.query_service.execute(exp_sql, limit=500, database=database)
                rows = result.get("rows", [])
                plan_text = "\n".join(str(r[0]) for r in rows if r)
            else:
                with adapter._lock:
                    cursor = adapter.get_cursor(database=database)
                    cursor.execute("SET SHOWPLAN_TEXT ON")
                    cursor.execute(sql)
                    rows = cursor.fetchall()
                    plan_text = "\n".join(str(r[0]) for r in rows if r)
                    try:
                        cursor.execute("SET SHOWPLAN_TEXT OFF")
                    except Exception:
                        pass
                    cursor.close()

            return {"success": True, "plan": plan_text}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache_dir = DATA_DIR / ".webview_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    index_html = (BASE_DIR / "templates" / "index.html").resolve().as_uri()
    splash_html = (BASE_DIR / "templates" / "splash.html").resolve().as_uri()
    main_api = MainApi(connection_manager)

    settings = _load_settings_file()
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

    # Fallback timer: sau 10.0s đảm bảo không bao giờ bị kẹt splash nếu frontend gặp sự cố ngoại lệ
    def on_fallback():
        nonlocal splash_min_timer_done, frontend_ready
        splash_min_timer_done = True
        frontend_ready = True
        maybe_transition()

    threading.Timer(10.0, on_fallback).start()

    print(f"[App] Starting Desktop pywebview with active theme: {cur_theme}")
    webview.start(gui="edgechromium", storage_path=str(cache_dir.resolve()), debug=False)


if __name__ == "__main__":
    main()
