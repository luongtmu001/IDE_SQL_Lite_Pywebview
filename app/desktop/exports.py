# -*- coding: utf-8 -*-
"""
Desktop export utilities for tabular SQL query results.
Supports opening in Microsoft Excel (with temporary file and auto-cleanup/read-only)
and saving to XLSX, CSV, TSV, or JSON via pywebview file dialog with Tkinter fallback.
"""
import csv
import ctypes
import datetime
import json
import os
import tempfile
import uuid
from typing import Any, Dict, List, Optional


def grid_open_in_excel(columns: Optional[List[Any]] = None, rows: Optional[List[Any]] = None) -> Dict[str, Any]:
    """Export tabular result rows to a temporary Excel (.xlsx) file and open with default application."""
    try:
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
            from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
            from openpyxl.utils import get_column_letter

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Query Results"

            header_font = Font(name="Segoe UI", size=10, bold=True, color="1F1F1F")
            header_fill = PatternFill(start_color="E6E6E6", end_color="E6E6E6", fill_type="solid")
            thin_border = Border(
                left=Side(style="thin", color="D4D4D4"),
                right=Side(style="thin", color="D4D4D4"),
                top=Side(style="thin", color="D4D4D4"),
                bottom=Side(style="thin", color="D4D4D4"),
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
                max_len = max([len(str(c.value or "")) for c in sample] or [10])
                ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 50)

            wb.save(file_path)
        except Exception:
            file_path = file_path.replace(".xlsx", ".csv")
            with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(col_names)
                for r in rows:
                    writer.writerow(["" if v is None else v for v in r])

        # Set read-only attribute on temporary export file
        try:
            ctypes.windll.kernel32.SetFileAttributesW(file_path, 1)  # FILE_ATTRIBUTE_READONLY
        except Exception:
            try:
                os.chmod(file_path, 0o444)
            except Exception:
                pass

        os.startfile(file_path)
        return {"success": True, "file_path": file_path}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def grid_save_results_as(
    columns: Optional[List[Any]] = None,
    rows: Optional[List[Any]] = None,
    default_filename: Optional[str] = None,
    window: Any = None,
) -> Dict[str, Any]:
    """Save tabular query results to XLSX, CSV, TSV, or JSON via save dialog."""
    try:
        columns = columns or []
        rows = rows or []
        col_names = [c if isinstance(c, str) else c.get("name", str(c)) for c in columns]
        default_fn = default_filename or "Query_Results.xlsx"

        target_win = window
        import webview

        if not target_win and hasattr(webview, "windows") and webview.windows:
            target_win = webview.windows[0]

        file_path = None
        if target_win:
            try:
                save_mode = getattr(webview.FileDialog, "SAVE", getattr(webview, "SAVE_DIALOG", 30))
                files = target_win.create_file_dialog(
                    save_mode,
                    save_filename=default_fn,
                    file_types=(
                        "Excel Files (*.xlsx)",
                        "CSV Files (*.csv)",
                        "TSV Files (*.txt)",
                        "JSON Files (*.json)",
                        "All Files (*.*)",
                    ),
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
            root.attributes("-topmost", True)
            file_path = filedialog.asksaveasfilename(
                initialfile=default_fn,
                filetypes=[
                    ("Excel Files (*.xlsx)", "*.xlsx"),
                    ("CSV Files (*.csv)", "*.csv"),
                    ("TSV Files (*.txt)", "*.txt"),
                    ("JSON Files (*.json)", "*.json"),
                    ("All Files (*.*)", "*.*"),
                ],
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
            from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
            from openpyxl.utils import get_column_letter

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Results"

            header_font = Font(name="Segoe UI", size=10, bold=True, color="1F1F1F")
            header_fill = PatternFill(start_color="E6E6E6", end_color="E6E6E6", fill_type="solid")
            thin_border = Border(
                left=Side(style="thin", color="D4D4D4"),
                right=Side(style="thin", color="D4D4D4"),
                top=Side(style="thin", color="D4D4D4"),
                bottom=Side(style="thin", color="D4D4D4"),
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
                max_len = max([len(str(c.value or "")) for c in sample] or [10])
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
