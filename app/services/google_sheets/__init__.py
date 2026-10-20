# -*- coding: utf-8 -*-
"""
Google Sheets Management Service Package for luoBTool IDE.
Contains:
- url_parser: URL validation & normalization for Google Sheets
- registry: Storage and atomic persistence of google_sheets.json
- service: High-level business logic for Projects & Sheets management
- webview_host: Companion subwindow lifecycle and system browser fallback
"""

from .url_parser import parse_google_sheets_url, is_valid_google_sheets_url
from .registry import GoogleSheetsRegistry
from .service import GoogleSheetsService
from .webview_host import GoogleSheetsWindowManager, get_window_manager
from .editor_host import GoogleSheetsEditorHost, EditorHostState, normalize_sheet_edit_url

__all__ = [
    "parse_google_sheets_url",
    "is_valid_google_sheets_url",
    "GoogleSheetsRegistry",
    "GoogleSheetsService",
    "GoogleSheetsWindowManager",
    "get_window_manager",
    "GoogleSheetsEditorHost",
    "EditorHostState",
    "normalize_sheet_edit_url",
]
