# -*- coding: utf-8 -*-
"""
Desktop themes and VS Code VSIX theme import utilities.
Parses JSONC, generates CSS custom properties, and imports themes from .vsix extension packages.
"""
import json
import os
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from app.utils.paths import get_bundle_dir


def clean_jsonc(text: str) -> str:
    """Strip comments and trailing commas from JSON with Comments (JSONC)."""
    pattern = r'("(?:\\.|[^"\\])*")|(/\*[\s\S]*?\*/)|(//[^\r\n]*)'

    def replace(match):
        if match.group(1):
            return match.group(1)
        return ""

    cleaned = re.sub(pattern, replace, text)
    cleaned = re.sub(r',\s*([\}\]])', r'\1', cleaned)
    return cleaned


def hex_to_rgb(color: str) -> Optional[Tuple[int, int, int]]:
    """Convert hex color string (#rgb, #rrggbb, #rrggbbaa) to (r, g, b) tuple."""
    if not color or not isinstance(color, str):
        return None
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join([ch * 2 for ch in c])
    if len(c) >= 6:
        try:
            return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
        except Exception:
            return None
    return None


def is_dark_color(color: str, fallback: bool = True) -> bool:
    """Calculate perceived luminance of a hex color to determine if it is dark."""
    rgb = hex_to_rgb(color)
    if not rgb:
        return fallback
    lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    return lum < 128


def generate_theme_css(
    theme_id: str, theme_name: str, theme_data: dict, is_dark: bool
) -> dict:
    """Generate CSS variables block and metadata dictionary for a theme."""
    colors = theme_data.get("colors", {})

    bg_editor = colors.get("editor.background") or ("#18191E" if is_dark else "#ffffff")
    bg_sidebar = colors.get("sideBar.background") or bg_editor
    bg_main = bg_sidebar
    bg_toolbar = (
        colors.get("titleBar.activeBackground")
        or colors.get("activityBar.background")
        or bg_sidebar
    )
    bg_panel = colors.get("panel.background") or bg_editor
    bg_input = colors.get("input.background") or (
        colors.get("editorWidget.background") or bg_editor
    )
    bg_modal = colors.get("editorWidget.background") or bg_sidebar
    bg_dropdown = colors.get("dropdown.background") or bg_modal
    bg_context_menu = colors.get("menu.background") or bg_modal

    fg_text = (
        colors.get("editor.foreground")
        or colors.get("foreground")
        or ("#c7cfcf" if is_dark else "#2b2b2b")
    )
    fg_muted = (
        colors.get("descriptionForeground")
        or colors.get("editorLineNumber.foreground")
        or ("#848c94" if is_dark else "#6c757d")
    )
    fg_active = colors.get("editor.foreground") or ("#ffffff" if is_dark else "#000000")

    border = (
        colors.get("sideBar.border")
        or colors.get("panel.border")
        or colors.get("tab.border")
        or ("#3c3f41" if is_dark else "#cccccc")
    )
    accent = (
        colors.get("button.background")
        or colors.get("activityBarBadge.background")
        or colors.get("focusBorder")
        or ("#CC7832" if is_dark else "#0066cc")
    )
    border_active = colors.get("focusBorder") or accent

    titlebar_bg = colors.get("titleBar.activeBackground") or bg_toolbar
    titlebar_text = colors.get("titleBar.activeForeground") or (
        "#ffffff" if is_dark_color(titlebar_bg) else "#000000"
    )

    tab_active_bg = colors.get("tab.activeBackground") or bg_editor
    tab_inactive_bg = colors.get("tab.inactiveBackground") or bg_toolbar
    tab_active_border = colors.get("tab.activeBorder") or accent
    grid_header_bg = colors.get("sideBarSectionHeader.background") or tab_inactive_bg

    danger = colors.get("errorForeground") or colors.get("editorError.foreground") or "#ff5c5c"
    warning = colors.get("editorWarning.foreground") or "#E8C859"
    info = colors.get("editorInfo.foreground") or "#6897BB"
    success = "#6A8759" if is_dark else "#4a7c3f"

    rgb_accent = hex_to_rgb(accent) or (204, 120, 50)
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
    --ide-bg-editor:                {bg_editor};
    --ide-bg-toolbar:               {bg_toolbar};
    --ide-bg-sidebar:               {bg_sidebar};
    --ide-bg-panel:                 {bg_panel};
    --ide-bg-input:                 {bg_input};
    --ide-bg-modal:                 {bg_modal};
    --ide-bg-dropdown:              {bg_dropdown};
    --ide-bg-context-menu:          {bg_context_menu};

    /* Typography */
    --ide-fg-text:                  {fg_text};
    --ide-fg-muted:                 {fg_muted};
    --ide-fg-active:                {fg_active};

    /* Borders & Accents */
    --ide-border:                   {border};
    --ide-border-active:            {border_active};
    --ide-accent:                   {accent};

    /* Status colors */
    --ide-danger:                   {danger};
    --ide-warning:                  {warning};
    --ide-info:                     {info};
    --ide-success:                  {success};

    /* Tabs */
    --ide-tab-active-bg:            {tab_active_bg};
    --ide-tab-inactive-bg:          {tab_inactive_bg};
    --ide-tab-active-border:        {tab_active_border};

    /* Grid */
    --ide-grid-header-bg:           {grid_header_bg};
    --ide-grid-header-fg:           {fg_text};
    --ide-grid-border:              {border};
    --ide-grid-row-alt:             rgba({rgb_accent_str}, 0.04);
    --ide-grid-row-selected:        rgba({rgb_accent_str}, 0.22);
    --ide-grid-cell-focus:          {border_active};

    /* Badges */
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
    cm_theme = "darcula" if is_dark else "default"
    return {
        "theme_id": theme_id,
        "theme_name": theme_name,
        "is_dark": is_dark,
        "cm_theme": cm_theme,
        "titlebar_bg": titlebar_bg,
        "titlebar_text": titlebar_text,
        "border": border,
        "css": css_block,
    }


def process_import_vsix_theme(vsix_path: str, base_dir: Optional[Path] = None) -> dict:
    """Import themes from a VS Code .vsix archive and register them into css/js files."""
    if not os.path.isfile(vsix_path):
        return {"success": False, "error": f"Không tìm thấy file: {vsix_path}"}

    if base_dir is None:
        base_dir = get_bundle_dir()

    try:
        with zipfile.ZipFile(vsix_path, "r") as z:
            pkg_entry = None
            for name in z.namelist():
                if name in ("extension/package.json", "package.json"):
                    pkg_entry = name
                    break
            if not pkg_entry:
                return {
                    "success": False,
                    "error": "Không tìm thấy file package.json trong tệp .vsix!",
                }

            pkg_raw = z.read(pkg_entry).decode("utf-8", errors="replace")
            pkg = json.loads(clean_jsonc(pkg_raw))

            themes = pkg.get("contributes", {}).get("themes", [])
            if not themes:
                return {
                    "success": False,
                    "error": "Không tìm thấy thông tin theme nào trong contributes.themes của package.json!",
                }

            # Nạp tất cả các theme có trong gói .vsix
            theme_entries = []
            has_dark = False
            has_light = False

            for idx, t_info in enumerate(themes):
                t_path = t_info.get("path", "").lstrip("./")
                if t_path.startswith("/"):
                    t_path = t_path.lstrip("/")

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
                    theme_raw = z.read(theme_file_entry).decode("utf-8", errors="replace")
                    theme_data = json.loads(clean_jsonc(theme_raw))
                except Exception as parse_err:
                    print(f"[VSIX] Failed to parse theme JSON {theme_file_entry}: {parse_err}")
                    continue

                colors = theme_data.get("colors", {})
                ui_theme = str(t_info.get("uiTheme") or theme_data.get("type") or "dark").lower()
                bg_editor = colors.get("editor.background") or (
                    "#18191E" if ("dark" in ui_theme or "hc" in ui_theme) else "#ffffff"
                )
                is_dark = is_dark_color(
                    bg_editor, fallback=("dark" in ui_theme or "hc" in ui_theme)
                )

                if is_dark:
                    has_dark = True
                else:
                    has_light = True

                theme_entries.append(
                    {"info": t_info, "data": theme_data, "is_dark": is_dark, "idx": idx}
                )

            if not theme_entries:
                return {
                    "success": False,
                    "error": "Không thể nạp bất kỳ file theme nào từ gói .vsix!",
                }

            # Xác định tên theme hiển thị và mã định danh duy nhất (theme_id)
            candidates = []
            seen_in_batch = set()

            for item in theme_entries:
                t_info = item["info"]
                t_data = item["data"]
                is_dark = item["is_dark"]
                idx = item["idx"]

                base_label = (
                    t_info.get("label")
                    or t_data.get("name")
                    or pkg.get("displayName")
                    or pkg.get("name")
                    or f"Theme {idx+1}"
                ).strip()

                # Nếu gói vsix có cả theme Dark và Light: chuẩn hóa tên phân biệt kiểu rõ ràng
                if has_dark and has_light:
                    base = re.sub(r"[\s\-_]+(light|dark)$", "", base_label, flags=re.I).strip()
                    if not base:
                        base = base_label
                    theme_name = f"{base} (Dark)" if is_dark else f"{base} (Light)"
                else:
                    theme_name = base_label

                raw_id = t_info.get("id") or theme_name
                theme_id = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw_id.lower()).strip("-")
                if not theme_id:
                    theme_id = f"theme-{idx+1}"

                if theme_id in seen_in_batch:
                    theme_id = f"{theme_id}-{'dark' if is_dark else 'light'}"
                seen_in_batch.add(theme_id)

                theme_css_info = generate_theme_css(theme_id, theme_name, t_data, is_dark)
                candidates.append(theme_css_info)

            # Kiểm tra trùng lặp trong hệ thống
            style_css_file = base_dir / "static" / "css" / "style.css"
            theme_vars_file = base_dir / "static" / "css" / "theme-variables.css"
            theme_reg_file = base_dir / "static" / "js" / "theme-registry.js"

            existing_ids = {"dark", "light", "win-nt", "win-xp", "monokai", "nord"}
            existing_names = set()

            if theme_vars_file.exists():
                with open(theme_vars_file, "r", encoding="utf-8") as f:
                    content = f.read()
                existing_ids.update(re.findall(r'data-bs-theme=[\'"]([^\'"]+)[\'"]', content))

            if style_css_file.exists():
                with open(style_css_file, "r", encoding="utf-8") as f:
                    content = f.read()
                existing_ids.update(re.findall(r'data-bs-theme=[\'"]([^\'"]+)[\'"]', content))

            if theme_reg_file.exists():
                with open(theme_reg_file, "r", encoding="utf-8") as f:
                    reg_content = f.read()
                existing_ids.update(re.findall(r'id:\s*[\'"]([^\'"]+)[\'"]', reg_content))
                existing_names.update(
                    [
                        n.lower().strip()
                        for n in re.findall(r'name:\s*[\'"]([^\'"]+)[\'"]', reg_content)
                    ]
                )

            themes_to_add = []
            duplicate_names = []

            for c in candidates:
                is_dup = (
                    c["theme_id"] in existing_ids
                    or (c["theme_id"] == "windows-nt" and "win-nt" in existing_ids)
                    or (c["theme_id"] == "win-nt" and "windows-nt" in existing_ids)
                    or c["theme_name"].lower().strip() in existing_names
                )
                if is_dup:
                    duplicate_names.append(c["theme_name"])
                else:
                    themes_to_add.append(c)

            if not themes_to_add:
                dups_str = ", ".join([f"'{n}'" for n in duplicate_names])
                return {
                    "success": False,
                    "error": f"Tất cả các theme trong file ({dups_str}) đã tồn tại trong hệ thống!",
                }

            combined_css = "\n".join([t["css"] for t in themes_to_add])

            # 1. Ghi vào static/css/theme-variables.css
            if theme_vars_file.exists():
                with open(theme_vars_file, "a", encoding="utf-8") as f:
                    f.write("\n" + combined_css)

            # 2. Cập nhật theme-registry.js
            for r_file in [theme_reg_file]:
                if r_file.exists():
                    with open(r_file, "r", encoding="utf-8") as f:
                        reg_code = f.read()

                    idx = reg_code.rfind("    ];")
                    if idx == -1:
                        idx = reg_code.rfind("];")

                    if idx != -1:
                        before = reg_code[:idx].rstrip()
                        if not before.endswith(","):
                            before += ","

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

                        match_len = 6 if reg_code[idx : idx + 6] == "    ];" else 2
                        new_reg_code = (
                            before + entries_str + "\n    ];" + reg_code[idx + match_len :]
                        )
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
                "message": f"Đã import thành công {len(themes_to_add)} theme ({theme_names_str})!",
            }

    except Exception as exc:
        import traceback

        traceback.print_exc()
        return {"success": False, "error": f"Lỗi khi giải nén file .vsix: {str(exc)}"}


# Aliases for backward compatibility
_clean_jsonc = clean_jsonc
_hex_to_rgb = hex_to_rgb
_is_dark_color = is_dark_color
_generate_theme_css = generate_theme_css
_process_import_vsix_theme = process_import_vsix_theme
